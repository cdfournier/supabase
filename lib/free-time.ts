import "server-only";
import type { AgentName } from "@/lib/agent-context";
import {
  isSurfaceAllowed,
  loadAgentCapabilityProfile
} from "@/lib/capability-profile";
import { sendAgentMessage } from "@/lib/chat-runtime";
import { readFreeMomentsEnabled, writeFreeMomentsEnabled } from "@/lib/runtime-settings";
import { getSupabaseAdmin } from "@/lib/supabase";

const AGENTS: AgentName[] = ["soren", "varro"];
const EVENT_LIMIT = 20;
const DEFAULT_INTERVAL_MINUTES = 120;
const MIN_INTERVAL_MINUTES = 5;
const DEFAULT_SCHEDULE_MODE: FreeTimeScheduleMode = "round_robin";
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
  | "turn_completed"
  | "turn_failed";

type FreeTimeEvent = {
  at: string;
  type: FreeTimeEventType;
  agent?: AgentName;
  message: string;
};

type FreeTimeScheduleMode = "round_robin" | "paired";

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
    return {
      ...status(),
      durable_enabled: await readFreeMomentsEnabled(),
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
  await writeFreeMomentsEnabled(true);
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
    await writeFreeMomentsEnabled(false);
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

async function runAgentTurn(agent: AgentName) {
  const capabilityProfile = await loadAgentCapabilityProfile(getSupabaseAdmin(), agent);

  if (!isSurfaceAllowed(capabilityProfile, "free_moments", "write")) {
    addEvent("tick_blocked", `Free Moment blocked for ${agent} by Agent Capability Profile.`, agent);
    return;
  }

  addEvent("turn_started", `Free Moment turn started for ${agent}.`, agent);

  try {
    await sendAgentMessage(agent, FREE_TIME_PROMPT, { source: "free_time" });
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
