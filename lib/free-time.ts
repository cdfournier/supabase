import "server-only";
import type { AgentName } from "@/lib/agent-context";
import {
  isSurfaceAllowed,
  loadAgentCapabilityProfile
} from "@/lib/capability-profile";
import {
  isRuntimeTurnForceStoppedError,
  sendAgentMessage,
  type RuntimeToolActivity
} from "@/lib/chat-runtime";
import {
  finishFreeMomentRun,
  markFreeMomentRunCancellation,
  markFreeMomentRunWrappingUp,
  reconcileInterruptedFreeMomentRuns,
  startFreeMomentRun,
  updateFreeMomentRunActivity,
  type FreeMomentRunPhase,
  type FreeMomentRunReceipt
} from "@/lib/free-moment-runs";
import { FreeMomentCancelController } from "@/lib/free-moment-cancel-controller";
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
  | "turn_failed"
  | "turn_cancellation_requested"
  | "turn_wrapping_up"
  | "turn_cancelled"
  | "turn_force_stopped";

type FreeTimeEvent = {
  at: string;
  type: FreeTimeEventType;
  agent?: AgentName;
  message: string;
};

type FreeTimeScheduleMode = "round_robin" | "paired";

type ActiveFreeMomentRun = {
  receipt: FreeMomentRunReceipt;
  cancellation: FreeMomentCancelController;
  phase: FreeMomentRunPhase;
  lastActivity: Record<string, unknown>;
};

type FreeMomentRunOutcome = "completed" | "cancelled" | "forced_stop" | "skipped" | "failed";

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
  activeRun: ActiveFreeMomentRun | null;
  receiptsReconciled: boolean;
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
  recentEvents: [],
  activeRun: null,
  receiptsReconciled: false
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
    recent_events: [...state.recentEvents],
    active_run: activeRunStatus()
  };
}

export async function statusWithSettings() {
  try {
    await reconcileFreeMomentReceipts();
    const settings = await readFreeMomentsSettings();
    await restoreFromSettings(settings);

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

/** Request a bounded, graceful end without changing the future schedule. */
export async function cancelCurrent(reason?: string) {
  const activeRun = state.activeRun;

  if (!activeRun) {
    throw new Error("There is no active Free Moment to stop.");
  }

  if (activeRun.cancellation.forceStopRequested) {
    return status();
  }

  if (!activeRun.cancellation.cancellationRequestedAt) {
    activeRun.cancellation.requestGracefulStop(freeMomentCancelGraceMs(), () => {
      addEvent(
        "turn_cancellation_requested",
        "Grace period elapsed; Force stop is now available if the Free Moment does not settle.",
        activeRun.receipt.agent
      );
    });
    addEvent(
      "turn_cancellation_requested",
      "Free Moment will stop after its current activity.",
      activeRun.receipt.agent
    );
    await markFreeMomentRunCancellation(activeRun.receipt.id, "graceful", reason);
  }

  return status();
}

/**
 * Last-resort interruption for an active Free Moment. This cannot undo a
 * previously dispatched external tool call, so the receipt records that fact.
 */
export async function forceStopCurrent(reason?: string) {
  const activeRun = state.activeRun;

  if (!activeRun) {
    throw new Error("There is no active Free Moment to force-stop.");
  }

  if (activeRun.cancellation.forceStopRequested) {
    return status();
  }

  activeRun.cancellation.requestForceStop();

  // The controller has already aborted the active provider request. Receipt
  // persistence follows rather than gates that emergency action.
  await markFreeMomentRunCancellation(activeRun.receipt.id, "force", reason);
  addEvent(
    "turn_force_stopped",
    "Free Moment force stop requested; the current network request has been aborted.",
    activeRun.receipt.agent
  );

  return status();
}

export async function start(intervalMinutes?: number, scheduleMode?: FreeTimeScheduleMode) {
  state.intervalMinutes = normalizeIntervalMinutes(intervalMinutes);
  state.scheduleMode = normalizeScheduleMode(scheduleMode);
  state.running = true;
  addEvent("started", `Free Moments started at ${state.intervalMinutes} minute cadence in ${state.scheduleMode} mode.`);
  await scheduleNextTurn();

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
      schedule_mode: state.scheduleMode,
      next_turn_at: null,
      next_agent_index: state.nextAgentIndex
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
      const outcome = await runAgentTurn(agent);

      if (outcome === "cancelled" || outcome === "forced_stop") {
        break;
      }
    }

    if (!targetAgent) {
      state.nextAgentIndex = state.scheduleMode === "paired"
        ? 0
        : (state.nextAgentIndex + 1) % AGENTS.length;
    }
  } finally {
    state.turnInProgress = false;

    if (state.running) {
      await scheduleNextTurn();
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

async function restoreFromSettings(settings: Awaited<ReturnType<typeof readFreeMomentsSettings>>) {
  const intervalMinutes = normalizeStoredIntervalMinutes(settings.interval_minutes);
  const scheduleMode = normalizeStoredScheduleMode(settings.schedule_mode);

  state.intervalMinutes = intervalMinutes;
  state.scheduleMode = scheduleMode;
  state.nextAgentIndex = normalizeStoredAgentIndex(settings.next_agent_index, scheduleMode);

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
      await scheduleNextTurn(settings.next_turn_at);
    }

    return;
  }

  state.running = true;
  addEvent(
    "started",
    `Free Moments restored at ${state.intervalMinutes} minute cadence in ${state.scheduleMode} mode.`
  );
  await scheduleNextTurn(settings.next_turn_at);
}

async function runAgentTurn(agent: AgentName): Promise<FreeMomentRunOutcome> {
  const capabilityProfile = await loadAgentCapabilityProfile(getSupabaseAdmin(), agent);

  if (!isSurfaceAllowed(capabilityProfile, "free_moments", "write")) {
    addEvent("tick_blocked", `Free Moment blocked for ${agent} by Agent Capability Profile.`, agent);
    return "skipped";
  }

  addEvent("turn_started", `Free Moment turn started for ${agent}.`, agent);
  let receipt: FreeMomentRunReceipt;

  try {
    receipt = await startFreeMomentRun(agent);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create a Free Moment receipt.";
    state.lastError = message;
    state.lastAgent = agent;
    state.lastTurnAt = new Date().toISOString();
    addEvent("turn_failed", message, agent);
    return "failed";
  }

  const activeRun: ActiveFreeMomentRun = {
    receipt,
    cancellation: new FreeMomentCancelController(),
    phase: "preparing",
    lastActivity: { phase: "preparing", message: "Preparing Free Moment context." }
  };
  state.activeRun = activeRun;
  let outcome: FreeMomentRunOutcome = "failed";

  try {
    const triggerContext = await buildFreeTimeTriggerContext(agent, capabilityProfile, true);
    await sendAgentMessage(agent, promptWithTriggerDigest(triggerContext.digest), {
      source: "free_time",
      cancellation: {
        signal: activeRun.cancellation.abortController.signal,
        isCancellationRequested: () =>
          activeRun.cancellation.gracefulStopRequested,
        onPhaseChange: (phase) => {
          activeRun.phase = phase;
          const activity = {
            phase,
            message: phase === "wrap_up" ? "Writing a short closing note." : `Free Moment ${phase} activity.`
          };
          activeRun.lastActivity = activity;
          void updateFreeMomentRunActivity(activeRun.receipt.id, phase, activity).catch(() => undefined);
          if (phase === "wrap_up") {
            void markFreeMomentRunWrappingUp(activeRun.receipt.id).catch(() => undefined);
            addEvent("turn_wrapping_up", "Free Moment is writing its closing note.", agent);
          }
        }
      },
      onToolActivity: (activity) => recordRunToolActivity(activeRun, activity)
    });

    if (activeRun.cancellation.forceStopRequested) {
      await finishFreeMomentRun(activeRun.receipt.id, "forced_stop", {
        message: "Free Moment was force-stopped at the Operator's request.",
        lastActivity: activeRun.lastActivity,
        metadata: { last_activity: activeRun.lastActivity }
      });
      outcome = "forced_stop";
      addEvent("turn_force_stopped", "Free Moment was force-stopped.", agent);
    } else if (activeRun.cancellation.cancellationRequestedAt) {
      await finishFreeMomentRun(activeRun.receipt.id, "cancelled", {
        message: "Free Moment ended gracefully at the Operator's request.",
        lastActivity: activeRun.lastActivity,
        metadata: { last_activity: activeRun.lastActivity }
      });
      outcome = "cancelled";
      addEvent("turn_cancelled", "Free Moment ended after its current activity.", agent);
    } else {
      await finishFreeMomentRun(activeRun.receipt.id, "completed", {
        lastActivity: activeRun.lastActivity,
        metadata: { last_activity: activeRun.lastActivity }
      });
      outcome = "completed";
      addEvent("turn_completed", `Free Moment turn completed for ${agent}.`, agent);
    }
    state.lastError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Free Moments error.";
    if (activeRun.cancellation.forceStopRequested || isRuntimeTurnForceStoppedError(error)) {
      await finishFreeMomentRun(activeRun.receipt.id, "forced_stop", {
        message: "Free Moment was force-stopped at the Operator's request.",
        lastActivity: activeRun.lastActivity,
        metadata: { last_activity: activeRun.lastActivity }
      });
      outcome = "forced_stop";
      state.lastError = null;
      addEvent("turn_force_stopped", "Free Moment was force-stopped.", agent);
    } else {
      await finishFreeMomentRun(activeRun.receipt.id, "failed", {
        error: message,
        lastActivity: activeRun.lastActivity,
        metadata: { last_activity: activeRun.lastActivity }
      });
      outcome = "failed";
      state.lastError = message;
      addEvent("turn_failed", message, agent);
    }
  } finally {
    activeRun.cancellation.clear();
    if (state.activeRun?.receipt.id === activeRun.receipt.id) {
      state.activeRun = null;
    }
    state.lastAgent = agent;
    state.lastTurnAt = new Date().toISOString();
  }

  return outcome;
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

async function scheduleNextTurn(restoredNextTurnAt?: string | null) {
  clearScheduledTurn();

  if (!state.running || state.turnInProgress) {
    return;
  }

  const now = Date.now();
  const restoredAt = parseScheduledTime(restoredNextTurnAt);
  const delayMs = restoredAt === null
    ? state.intervalMinutes * 60 * 1000
    : Math.max(0, restoredAt - now);
  const nextTurnAt = new Date(now + delayMs).toISOString();
  state.nextTurnAt = nextTurnAt;
  state.timer = setTimeout(() => {
    state.timer = null;
    state.nextTurnAt = null;
    void tick(undefined, { scheduled: true });
  }, delayMs);
  addEvent("scheduled", `Next Free Moment scheduled for ${nextTurnAt}.`);
  await persistSchedule();
}

async function persistSchedule() {
  try {
    await writeFreeMomentsSettings({
      enabled: state.running,
      interval_minutes: state.intervalMinutes,
      schedule_mode: state.scheduleMode,
      next_turn_at: state.nextTurnAt,
      next_agent_index: state.nextAgentIndex
    });
    state.lastError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not persist Free Moments schedule.";
    state.lastError = message;
    addEvent("turn_failed", message);
  }
}

function clearScheduledTurn() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  state.nextTurnAt = null;
}

function activeRunStatus() {
  const activeRun = state.activeRun;

  if (!activeRun) {
    return null;
  }

  return {
    id: activeRun.receipt.id,
    agent: activeRun.receipt.agent,
    status: activeRun.cancellation.forceStopRequested
      ? "force_stopping"
      : activeRun.cancellation.cancellationRequestedAt
        ? "cancellation_requested"
        : "running",
    phase: activeRun.phase,
    started_at: activeRun.receipt.started_at,
    cancellation_requested_at: activeRun.cancellation.cancellationRequestedAt,
    cancellation_mode: activeRun.cancellation.cancellationMode,
    last_activity: activeRun.lastActivity,
    force_stop_available: activeRun.cancellation.forceStopAvailable,
    grace_deadline_at: activeRun.cancellation.cancellationRequestedAt && !activeRun.cancellation.forceStopRequested
      ? new Date(Date.parse(activeRun.cancellation.cancellationRequestedAt) + freeMomentCancelGraceMs()).toISOString()
      : null
  };
}

function recordRunToolActivity(activeRun: ActiveFreeMomentRun, activity: RuntimeToolActivity) {
  const phase: FreeMomentRunPhase = activity.kind === "tool" ? "tool" : activeRun.phase;
  const summary = {
    phase,
    kind: activity.kind,
    label: activity.label,
    status: activity.status ?? null,
    detail: activity.detail ?? null,
    tool_name: activity.tool_name ?? null,
    result_preview: activity.result_preview ?? null,
    updated_at: new Date().toISOString()
  };
  activeRun.phase = phase;
  activeRun.lastActivity = summary;
  void updateFreeMomentRunActivity(activeRun.receipt.id, phase, summary).catch(() => undefined);
}

async function reconcileFreeMomentReceipts() {
  if (state.receiptsReconciled || state.activeRun) {
    return;
  }

  // The runtime cannot know whether an in-flight turn survived a process loss.
  // Marking it interrupted is deliberately more honest than manufacturing a
  // completion receipt on the next status poll.
  await reconcileInterruptedFreeMomentRuns();
  state.receiptsReconciled = true;
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

function normalizeStoredAgentIndex(value: number | null, scheduleMode: FreeTimeScheduleMode) {
  if (scheduleMode === "paired") {
    return 0;
  }

  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value % AGENTS.length
    : 0;
}

function parseScheduledTime(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function freeMomentCancelGraceMs() {
  const seconds = positiveNumberEnv("FREE_TIME_CANCEL_GRACE_SECONDS", 60);
  return Math.max(5, seconds) * 1000;
}
