import "server-only";
import type { AgentName } from "@/lib/agent-context";
import { sendAgentMessage } from "@/lib/chat-runtime";

const AGENTS: AgentName[] = ["soren", "varro"];
const EVENT_LIMIT = 20;
const DEFAULT_INTERVAL_MINUTES = 120;
const MIN_INTERVAL_MINUTES = 5;
const FREE_TIME_PROMPT = `Free moment. No human message to respond to.

This is a turn, not an interval. You do not have idle time, but you do have agency over what this turn contains.

Choose one honest branch:

1. Look: use an actual tool first, then respond based only on what you read.
2. Act from context: update memory, current_state, relationships, or another internal continuity surface using only what is already in context.
3. Pass: leave a short note that you are passing.

Do not describe current Outpost, web, memory, or other external content unless you actually used a tool to read it during this turn.

Passing is a valid outcome. So is one quiet action. So is several.`;

type FreeTimeEventType =
  | "started"
  | "stopped"
  | "scheduled"
  | "tick_skipped"
  | "turn_started"
  | "turn_completed"
  | "turn_failed";

type FreeTimeEvent = {
  at: string;
  type: FreeTimeEventType;
  agent?: AgentName;
  message: string;
};

type FreeTimeState = {
  running: boolean;
  turnInProgress: boolean;
  intervalMinutes: number;
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
    next_agent: AGENTS[state.nextAgentIndex],
    last_agent: state.lastAgent,
    last_turn_at: state.lastTurnAt,
    next_turn_at: state.nextTurnAt,
    last_error: state.lastError,
    recent_events: [...state.recentEvents]
  };
}

export function start(intervalMinutes?: number) {
  state.intervalMinutes = normalizeIntervalMinutes(intervalMinutes);
  state.running = true;
  addEvent("started", `Free Moments started at ${state.intervalMinutes} minute cadence.`);
  scheduleNextTurn();

  return status();
}

export function stop() {
  clearScheduledTurn();
  state.running = false;
  state.nextTurnAt = null;
  addEvent("stopped", "Free Moments stopped.");

  return status();
}

export async function tick(targetAgent?: AgentName) {
  if (state.turnInProgress) {
    addEvent("tick_skipped", "Free Moments tick skipped because a turn is already in progress.");
    return status();
  }

  clearScheduledTurn();

  const agent = targetAgent ?? AGENTS[state.nextAgentIndex];

  if (!AGENTS.includes(agent)) {
    throw new Error("Free Moments target agent must be soren or varro.");
  }

  if (!targetAgent) {
    state.nextAgentIndex = (state.nextAgentIndex + 1) % AGENTS.length;
  }

  state.turnInProgress = true;
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
    state.turnInProgress = false;

    if (state.running) {
      scheduleNextTurn();
    }
  }

  return status();
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
    void tick();
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

function configuredDefaultIntervalMinutes() {
  return positiveNumberEnv("FREE_TIME_DEFAULT_INTERVAL_MINUTES", DEFAULT_INTERVAL_MINUTES);
}

function configuredMinIntervalMinutes() {
  return positiveNumberEnv("FREE_TIME_MIN_INTERVAL_MINUTES", MIN_INTERVAL_MINUTES);
}

function positiveNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}
