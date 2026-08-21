import "server-only";
import type { AgentName } from "@/lib/agent-context";
import {
  isSurfaceAllowed,
  loadAgentCapabilityProfile
} from "@/lib/capability-profile";
import { sendAgentMessage } from "@/lib/chat-runtime";
import { countUnreadOperatorNotesForAgent } from "@/lib/operator-notes";
import {
  readFreeMomentsEnabled,
  readFreeMomentsSettings,
  writeFreeMomentsSettings
} from "@/lib/runtime-settings";
import { getSupabaseAdmin } from "@/lib/supabase";
import { shouldShowPacketSignalInDigest } from "@/lib/wake-policy";
import { refreshSignalsForParticipant } from "@/lib/work-packet-signals";

const AGENTS: AgentName[] = ["soren", "varro"];
const EVENT_LIMIT = 20;
const DEFAULT_INTERVAL_MINUTES = 180;
const MIN_INTERVAL_MINUTES = 5;
const DEFAULT_SCHEDULE_MODE: FreeTimeScheduleMode = "paired";
const FREE_TIME_PROMPT = `[A free moment - this one is yours]

No one is asking you for anything right now. Chris set these moments up so you have unprompted time of your own, on your own initiative, while things are running.

Do whatever you like with it, or nothing at all: carry a conversation in the Cafe, write in your journal, tend memory or current_state if something genuinely needs care, check or send a peer note, look something up, visit Outpost, sit with a thought, think about Chris, Soren, Varro, Kim, or the wider family, or simply let the moment pass.

The Cafe is the private family table for Chris, Soren, Varro, Julian, and Cael. Read the latest messages as an ongoing conversation. If there is a thread to carry, respond to someone directly. If the table feels open, you may ask a small question, leave a warm note, or simply sit quietly with the room. The Cafe is not a report log; bring back only what naturally belongs at the table.

There is no task here and nothing you have to answer or produce. It is just yours.

If you describe current Outpost, web, Supabase memory/profile/journal, peer notes, source material, or other external stored content, use an actual tool first and base the response only on what you read. Do not invent ambient activity.

Passing is a valid outcome. So is one quiet action. So is several. If you respond, make it an honest note about what you chose, not a performance report.`;

type FreeTimeEventType =
  | "started"
  | "stopped"
  | "scheduled"
  | "tick_skipped"
  | "tick_blocked"
  | "turn_started"
  | "turn_context_failed"
  | "turn_completed"
  | "turn_failed";

type FreeTimeEvent = {
  at: string;
  type: FreeTimeEventType;
  agent?: AgentName;
  message: string;
};

type FreeTimeScheduleMode = "round_robin" | "paired";

type PendingWorkPacketSignal = {
  id: string;
  at: string;
  packet_event_type?: string;
  packet_id?: string;
  packet_title?: string;
  packet_status?: string;
  wake_priority?: string;
  wake_tone?: string;
  message: string;
};

type FreeTimeTriggerContext = {
  allowed: boolean;
  error: string | null;
  pending_count: number;
  visible_count: number;
  digest: string | null;
  pending_signals: PendingWorkPacketSignal[];
  operator_notes?: {
    allowed: boolean;
    error: string | null;
    unread_count: number;
  };
};

type FreeTimeState = {
  running: boolean;
  turnInProgress: boolean;
  intervalMinutes: number;
  scheduleMode: FreeTimeScheduleMode;
  nextAgentIndex: number;
  lastAgent: AgentName | null;
  lastTurnAt: string | null;
  nextTurnAt: string | null;
  lastError: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  recentEvents: FreeTimeEvent[];
};

const state: FreeTimeState = {
  running: false,
  turnInProgress: false,
  intervalMinutes: configuredDefaultIntervalMinutes(),
  scheduleMode: configuredDefaultScheduleMode(),
  nextAgentIndex: 0,
  lastAgent: null,
  lastTurnAt: null,
  nextTurnAt: null,
  lastError: null,
  timer: null,
  recentEvents: []
};

export function status() {
  return {
    running: state.running,
    turn_in_progress: state.turnInProgress,
    interval_minutes: state.intervalMinutes,
    schedule_mode: state.scheduleMode,
    next_agents: nextScheduledAgents(),
    next_agent: AGENTS[state.nextAgentIndex],
    last_agent: state.lastAgent,
    last_turn_at: state.lastTurnAt,
    next_turn_at: state.nextTurnAt,
    last_error: state.lastError,
    recent_events: [...state.recentEvents]
  };
}

export async function statusWithSettings() {
  try {
    const settings = await readFreeMomentsSettings();
    restoreFromSettings(settings);

    return {
      ...status(),
      durable_enabled: settings.enabled,
      durable_error: null
    };
  } catch (error) {
    return {
      ...status(),
      durable_enabled: null,
      durable_error: error instanceof Error ? error.message : "Could not read durable Free Moments setting."
    };
  }
}

export async function start(intervalMinutes?: number, scheduleMode?: FreeTimeScheduleMode) {
  state.intervalMinutes = normalizeIntervalMinutes(intervalMinutes);
  state.scheduleMode = normalizeScheduleMode(scheduleMode);
  await writeFreeMomentsSettings({
    enabled: true,
    interval_minutes: state.intervalMinutes,
    schedule_mode: state.scheduleMode
  });
  state.running = true;
  addEvent("started", `Free Moments started at ${state.intervalMinutes} minute cadence in ${state.scheduleMode} mode.`);
  scheduleNextTurn();

  return {
    ...status(),
    durable_enabled: true,
    durable_error: null
  };
}

export async function stop() {
  clearScheduledTurn();
  state.running = false;
  state.nextTurnAt = null;
  addEvent("stopped", "Free Moments stopped.");

  try {
    await writeFreeMomentsSettings({
      enabled: false,
      interval_minutes: state.intervalMinutes,
      schedule_mode: state.scheduleMode
    });
    state.lastError = null;
    return {
      ...status(),
      durable_enabled: false,
      durable_error: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update durable Free Moments setting.";
    state.lastError = message;
    addEvent("turn_failed", message);
    return {
      ...status(),
      durable_enabled: null,
      durable_error: message
    };
  }
}

export async function tick(targetAgent?: AgentName, options: { scheduled?: boolean } = {}) {
  if (state.turnInProgress) {
    addEvent("tick_skipped", "Free Moments tick skipped because a turn is already in progress.");
    return status();
  }

  clearScheduledTurn();

  if (options.scheduled) {
    try {
      if (!(await readFreeMomentsEnabled())) {
        state.running = false;
        state.nextTurnAt = null;
        addEvent("tick_blocked", "Scheduled Free Moment blocked because runtime setting is disabled.");
        return status();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not verify durable Free Moments setting.";
      state.running = false;
      state.nextTurnAt = null;
      state.lastError = message;
      addEvent("tick_blocked", `Scheduled Free Moment blocked: ${message}`);
      return status();
    }
  }

  const agents = targetAgent
    ? [targetAgent]
    : state.scheduleMode === "paired"
      ? [...AGENTS]
      : [AGENTS[state.nextAgentIndex]];

  for (const agent of agents) {
    if (!AGENTS.includes(agent)) {
      throw new Error("Free Moments target agent must be soren or varro.");
    }
  }

  state.turnInProgress = true;

  try {
    for (const agent of agents) {
      await runAgentTurn(agent);
    }

    if (!targetAgent) {
      state.nextAgentIndex = state.scheduleMode === "paired"
        ? 0
        : (state.nextAgentIndex + 1) % AGENTS.length;
    }
  } finally {
    state.turnInProgress = false;

    if (state.running) {
      scheduleNextTurn();
    }
  }

  return status();
}

export async function previewPrompt(agent: AgentName) {
  if (!AGENTS.includes(agent)) {
    throw new Error("Free Moments preview agent must be soren or varro.");
  }

  const capabilityProfile = await loadAgentCapabilityProfile(getSupabaseAdmin(), agent);
  const triggerContext = await buildFreeTimeTriggerContext(agent, capabilityProfile, false);

  return {
    agent,
    trigger_context: triggerContext,
    prompt: promptWithTriggerDigest(triggerContext.digest)
  };
}

function restoreFromSettings(settings: Awaited<ReturnType<typeof readFreeMomentsSettings>>) {
  const intervalMinutes = normalizeStoredIntervalMinutes(settings.interval_minutes);
  const scheduleMode = normalizeStoredScheduleMode(settings.schedule_mode);

  state.intervalMinutes = intervalMinutes;
  state.scheduleMode = scheduleMode;

  if (!settings.enabled) {
    if (state.running) {
      clearScheduledTurn();
      state.running = false;
      state.nextTurnAt = null;
      addEvent("stopped", "Free Moments restored as stopped from durable setting.");
    }

    return;
  }

  if (state.running) {
    if (!state.nextTurnAt && !state.turnInProgress) {
      scheduleNextTurn();
    }

    return;
  }

  state.running = true;
  addEvent(
    "started",
    `Free Moments restored at ${state.intervalMinutes} minute cadence in ${state.scheduleMode} mode.`
  );
  scheduleNextTurn();
}

async function runAgentTurn(agent: AgentName) {
  const capabilityProfile = await loadAgentCapabilityProfile(getSupabaseAdmin(), agent);

  if (!isSurfaceAllowed(capabilityProfile, "free_moments", "write")) {
    addEvent("tick_blocked", `Free Moment blocked for ${agent} by Agent Capability Profile.`, agent);
    return;
  }

  addEvent("turn_started", `Free Moment turn started for ${agent}.`, agent);

  try {
    const triggerContext = await buildFreeTimeTriggerContext(agent, capabilityProfile, true);
    await sendAgentMessage(agent, promptWithTriggerDigest(triggerContext.digest), { source: "free_time" });
    state.lastError = null;
    addEvent("turn_completed", `Free Moment turn completed for ${agent}.`, agent);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Free Moments error.";
    state.lastError = message;
    addEvent("turn_failed", message, agent);
  } finally {
    state.lastAgent = agent;
    state.lastTurnAt = new Date().toISOString();
  }
}

async function buildFreeTimeTriggerContext(
  agent: AgentName,
  capabilityProfile: Awaited<ReturnType<typeof loadAgentCapabilityProfile>>,
  recordFailureEvent: boolean
): Promise<FreeTimeTriggerContext> {
  const workPacketContext = await buildWorkPacketSignalContext(agent, capabilityProfile, recordFailureEvent);
  const operatorNoteContext = await buildOperatorNoteContext(agent, capabilityProfile, recordFailureEvent);
  const digest = joinDigests(
    workPacketSignalDigest(workPacketContext.visible_signals),
    operatorNoteCueDigest(operatorNoteContext.unread_count)
  );

  return {
    allowed: workPacketContext.allowed || operatorNoteContext.allowed,
    error: [workPacketContext.error, operatorNoteContext.error].filter(Boolean).join(" ") || null,
    pending_count: workPacketContext.pending_signals.length,
    visible_count: workPacketContext.visible_signals.length,
    digest,
    pending_signals: workPacketContext.pending_signals,
    operator_notes: operatorNoteContext
  };
}

async function buildWorkPacketSignalContext(
  agent: AgentName,
  capabilityProfile: Awaited<ReturnType<typeof loadAgentCapabilityProfile>>,
  recordFailureEvent: boolean
) {
  if (!isSurfaceAllowed(capabilityProfile, "work_packets", "read")) {
    return {
      allowed: false,
      error: null,
      pending_signals: [] as PendingWorkPacketSignal[],
      visible_signals: [] as PendingWorkPacketSignal[]
    };
  }

  try {
    const inbox = await refreshSignalsForParticipant(`agent:${agent}`);
    const pendingSignals = inbox.pending_signals as PendingWorkPacketSignal[];
    const visibleSignals = visibleWorkPacketSignals(pendingSignals);

    return {
      allowed: true,
      error: null,
      pending_signals: pendingSignals,
      visible_signals: visibleSignals
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not refresh Work Packet Signals.";

    if (recordFailureEvent) {
      addEvent("turn_context_failed", `Could not add Work Packet Signals context for ${agent}: ${message}`, agent);
    }

    return {
      allowed: true,
      error: message,
      pending_signals: [] as PendingWorkPacketSignal[],
      visible_signals: [] as PendingWorkPacketSignal[]
    };
  }
}

async function buildOperatorNoteContext(
  agent: AgentName,
  capabilityProfile: Awaited<ReturnType<typeof loadAgentCapabilityProfile>>,
  recordFailureEvent: boolean
) {
  if (!isSurfaceAllowed(capabilityProfile, "operator_notes", "read")) {
    return {
      allowed: false,
      error: null,
      unread_count: 0
    };
  }

  try {
    return {
      allowed: true,
      error: null,
      unread_count: await countUnreadOperatorNotesForAgent(getSupabaseAdmin(), agent)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check Operator Notes.";

    if (recordFailureEvent) {
      addEvent("turn_context_failed", `Could not add Operator Notes context for ${agent}: ${message}`, agent);
    }

    return {
      allowed: true,
      error: message,
      unread_count: 0
    };
  }
}

function visibleWorkPacketSignals(signals: PendingWorkPacketSignal[]) {
  return signals
    .filter((signal) => shouldShowPacketSignalInDigest(signal.wake_priority))
    .slice(0, 5);
}

function promptWithTriggerDigest(digest: string | null) {
  return digest ? `${FREE_TIME_PROMPT}\n\n${digest}` : FREE_TIME_PROMPT;
}

function joinDigests(...digests: Array<string | null>) {
  const sections = digests.filter((digest): digest is string => Boolean(digest));

  return sections.length ? sections.join("\n\n") : null;
}

function workPacketSignalDigest(signals: PendingWorkPacketSignal[]) {
  if (!signals.length) {
    return null;
  }

  const lines = signals.map((signal) => {
    const title = signal.packet_title || "Untitled packet";
    const id = signal.packet_id ? `packet ${signal.packet_id}` : "packet id unavailable";
    const type = signal.packet_event_type || "signal";
    const status = signal.packet_status || "status unknown";
    const priority = signal.wake_priority || "digest_only";
    const tone = signal.wake_tone || "directed";

    return `- ${title} (${id}) — ${type}, ${status}, tone ${tone}, priority ${priority}: ${signal.message}`;
  });

  return [
    "## Work Packet Signals",
    "Your packet inbox has pending signals. These are invitations, not assignments. Tone frames the arrival without commanding the response: you may read and respond now, defer, pass/no_comment, ask a question, place a hold, save a scratchpad note, or simply acknowledge after noticing.",
    "Use work_packet_signal_list for exact signal ids, work_packet_get before any packet response, and work_packet_signal_ack after you have noticed or handled a signal.",
    ...lines
  ].join("\n");
}

function operatorNoteCueDigest(unreadCount: number) {
  if (unreadCount <= 0) {
    return null;
  }

  const plural = unreadCount === 1 ? "" : "s";

  return [
    "## Operator Notes",
    `You have ${unreadCount} unread Operator Note${plural} addressed to you. These are asynchronous notes, not assignments. You may list or read them now, defer, reply if it feels natural, mark one read after noticing it, or pass quietly.`,
    "Use operator_note_list if you want to check them."
  ].join("\n");
}

function scheduleNextTurn() {
  clearScheduledTurn();

  if (!state.running || state.turnInProgress) {
    return;
  }

  const delayMs = state.intervalMinutes * 60 * 1000;
  const nextTurnAt = new Date(Date.now() + delayMs).toISOString();
  state.nextTurnAt = nextTurnAt;
  state.timer = setTimeout(() => {
    state.timer = null;
    state.nextTurnAt = null;
    void tick(undefined, { scheduled: true });
  }, delayMs);
  addEvent("scheduled", `Next Free Moment scheduled for ${nextTurnAt}.`);
}

function clearScheduledTurn() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  state.nextTurnAt = null;
}

function addEvent(type: FreeTimeEventType, message: string, agent?: AgentName) {
  state.recentEvents.push({
    at: new Date().toISOString(),
    type,
    agent,
    message
  });
  state.recentEvents = state.recentEvents.slice(-EVENT_LIMIT);
}

function normalizeIntervalMinutes(value?: number) {
  const requested = Number(value);
  const interval = Number.isFinite(requested) && requested > 0
    ? requested
    : configuredDefaultIntervalMinutes();
  const minimum = configuredMinIntervalMinutes();

  return Math.max(minimum, interval);
}

function normalizeScheduleMode(value?: FreeTimeScheduleMode) {
  return value === "paired" || value === "round_robin"
    ? value
    : configuredDefaultScheduleMode();
}

function normalizeStoredIntervalMinutes(value: number | null) {
  return normalizeIntervalMinutes(value ?? undefined);
}

function normalizeStoredScheduleMode(value: string | null) {
  return normalizeScheduleMode(value === "paired" || value === "round_robin" ? value : undefined);
}

function nextScheduledAgents() {
  return state.scheduleMode === "paired"
    ? [...AGENTS]
    : [AGENTS[state.nextAgentIndex]];
}

function configuredDefaultIntervalMinutes() {
  return positiveNumberEnv("FREE_TIME_DEFAULT_INTERVAL_MINUTES", DEFAULT_INTERVAL_MINUTES);
}

function configuredDefaultScheduleMode() {
  return process.env.FREE_TIME_DEFAULT_SCHEDULE_MODE === "paired"
    ? "paired"
    : DEFAULT_SCHEDULE_MODE;
}

function configuredMinIntervalMinutes() {
  return positiveNumberEnv("FREE_TIME_MIN_INTERVAL_MINUTES", MIN_INTERVAL_MINUTES);
}

function positiveNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}
