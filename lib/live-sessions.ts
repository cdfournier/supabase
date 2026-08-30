import {
  joinBar,
  leaveBar,
  loadBar
} from "./bar.ts";

type NativeAgentName = "soren" | "varro";
export type BridgeAgentName = "julian" | "cael";
export type LiveSessionAgentName = NativeAgentName | BridgeAgentName;

export type LiveSessionSurface = "bar";
export type LiveSessionStatus = "active" | "ended";
export type LiveSessionParticipantStatus = "joined" | "left" | "degraded";
export type LiveSessionTickMode = "manual" | "interval";
export type LiveSessionBridgeDeliveryStatus = "pending" | "claimed" | "delivered" | "skipped" | "failed" | "cancelled";
export type LiveSessionBridgeDeliveryMethod = "codex_task" | "cowork_connector" | "manual";

export type LiveSessionTickPolicy = {
  mode: LiveSessionTickMode;
  interval_seconds: number | null;
  last_tick_at: string | null;
  next_tick_at: string | null;
};

export type LiveSessionParticipant = {
  participant_id: `agent:${LiveSessionAgentName}`;
  agent: LiveSessionAgentName;
  adapter: "runtime_native" | "external_bridge";
  status: LiveSessionParticipantStatus;
  joined_at: string;
  left_at: string | null;
  last_seen_at: string;
  last_checked_event_at: string | null;
  turn_in_progress: boolean;
  last_error: string | null;
};

export type LiveSessionEvent = {
  id: string;
  session_id: string;
  type:
    | "created"
    | "joined"
    | "left"
    | "ended"
    | "policy_updated"
    | "runner_started"
    | "runner_stopped"
    | "tick_started"
    | "tick_completed"
    | "tick_skipped"
    | "tick_failed"
    | "bridge_attendant_started"
    | "bridge_attendant_stopped"
    | "bridge_read"
    | "bridge_ack"
    | "bridge_delivery_queued"
    | "bridge_delivery_claimed"
    | "bridge_delivery_completed"
    | "bridge_delivery_failed"
    | "bridge_delivery_skipped"
    | "bridge_delivery_cancelled";
  at: string;
  participant_id?: string;
  message: string;
};

export type LiveSessionBridgeAttendantStatus = "attending" | "stopped";

export type LiveSessionBridgeAttendant = {
  participant_id: `agent:${BridgeAgentName}`;
  agent: BridgeAgentName;
  status: LiveSessionBridgeAttendantStatus;
  session_id: string;
  interval_seconds: number;
  started_at: string;
  stopped_at: string | null;
  last_poll_at: string | null;
  last_ack_at: string | null;
  last_delivery_queued_at: string | null;
  last_delivery_completed_at: string | null;
  last_error: string | null;
  pending_event_count: number;
  pending_delivery_count: number;
};

export type LiveSessionBridgeDeliveryTarget = {
  method: LiveSessionBridgeDeliveryMethod;
  label: string;
  status: "configured" | "adapter_required";
  metadata: Record<string, string | boolean | null>;
};

export type LiveSessionBridgeAdapterStatus = {
  agent: BridgeAgentName;
  autodeliver_enabled: boolean;
  target: LiveSessionBridgeDeliveryTarget;
  ready: boolean;
  reason: string | null;
};

export type LiveSessionBridgeDelivery = {
  id: string;
  session_id: string;
  participant_id: `agent:${BridgeAgentName}`;
  agent: BridgeAgentName;
  status: LiveSessionBridgeDeliveryStatus;
  delivery_method: LiveSessionBridgeDeliveryMethod;
  target: LiveSessionBridgeDeliveryTarget;
  event_cutoff_at: string;
  event_count: number;
  pending_events: Array<{
    id: string;
    author_id: string;
    author_display_name: string;
    content: string;
    created_at: string;
  }>;
  prompt: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  claim_id: string | null;
  completed_at: string | null;
  failed_at: string | null;
  last_error: string | null;
};

export type LiveSession = {
  id: string;
  surface: LiveSessionSurface;
  status: LiveSessionStatus;
  title: string;
  tick_policy: LiveSessionTickPolicy;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  participants: Partial<Record<LiveSessionAgentName, LiveSessionParticipant>>;
  bridge_attendants: Partial<Record<BridgeAgentName, LiveSessionBridgeAttendant>>;
  bridge_deliveries: LiveSessionBridgeDelivery[];
  events: LiveSessionEvent[];
};

export type LiveSessionStatusPayload = {
  generated_at: string;
  active_session: LiveSession | null;
  bridge_adapters: Record<BridgeAgentName, LiveSessionBridgeAdapterStatus>;
  runner: LiveSessionRunnerSnapshot;
  sessions: LiveSession[];
};

type SessionState = {
  sessions: LiveSession[];
};

type LiveSessionRunnerState = {
  timer: ReturnType<typeof setInterval> | null;
  session_id: string | null;
  interval_seconds: number;
  started_at: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  tick_in_progress: boolean;
  tick_count: number;
};

export type LiveSessionRunnerSnapshot = {
  status: "running" | "stopped";
  session_id: string | null;
  interval_seconds: number;
  started_at: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  tick_in_progress: boolean;
  tick_count: number;
};

const NATIVE_AGENTS: NativeAgentName[] = ["soren", "varro"];
const BRIDGE_AGENTS: BridgeAgentName[] = ["julian", "cael"];
const ALL_SESSION_AGENTS: LiveSessionAgentName[] = [...NATIVE_AGENTS, ...BRIDGE_AGENTS];
const EVENT_LIMIT = 80;
const BRIDGE_DELIVERY_LIMIT = 120;
const LIVE_SESSION_STATE_KEY = "live_sessions_state_v1";
const state = globalLiveSessionState();
const runner = globalLiveSessionRunnerState();
let hydrated = false;

export async function liveSessionStatus(): Promise<LiveSessionStatusPayload> {
  await ensureSessionHydrated();
  const sessions = state.sessions.map(cloneSession);

  return {
    generated_at: new Date().toISOString(),
    active_session: sessions.find((session) => session.status === "active") ?? null,
    bridge_adapters: bridgeAdapterStatuses(),
    runner: liveSessionRunnerStatus(),
    sessions
  };
}

export function startLiveSession(input: {
  surface?: LiveSessionSurface;
  title?: string;
  agents?: NativeAgentName[];
  bridgeAgents?: BridgeAgentName[];
  tickPolicy?: Partial<LiveSessionTickPolicy>;
} = {}) {
  return startLiveSessionAsync(input);
}

export async function startLiveSessionAsync(input: {
  surface?: LiveSessionSurface;
  title?: string;
  agents?: NativeAgentName[];
  bridgeAgents?: BridgeAgentName[];
  tickPolicy?: Partial<LiveSessionTickPolicy>;
} = {}) {
  await ensureSessionHydrated();
  const surface = input.surface ?? "bar";
  const agents = normalizeNativeAgents(input.agents);
  const bridgeAgents = normalizeBridgeAgents(input.bridgeAgents);
  const existing = activeSession(surface);

  if (existing) {
    for (const agent of agents) {
      await joinLiveSessionAgent(existing.id, agent);
    }
    for (const agent of bridgeAgents) {
      await joinLiveSessionAgent(existing.id, agent);
    }
    if (input.tickPolicy) {
      existing.tick_policy = normalizeTickPolicy(input.tickPolicy, existing.tick_policy);
      await persistSessionState();
    }

    return cloneSession(existing);
  }

  const now = new Date().toISOString();
  const session: LiveSession = {
    id: crypto.randomUUID(),
    surface,
    status: "active",
    title: input.title?.trim() || "BAR Live Session",
    tick_policy: normalizeTickPolicy(input.tickPolicy),
    created_at: now,
    updated_at: now,
    ended_at: null,
    participants: {},
    bridge_attendants: {},
    bridge_deliveries: [],
    events: []
  };

  state.sessions.unshift(session);
  trimSessions();
  addEvent(session, "created", "Live session created.");

  for (const agent of agents) {
    await joinLiveSessionAgent(session.id, agent);
  }
  for (const agent of bridgeAgents) {
    await joinLiveSessionAgent(session.id, agent);
  }

  if (session.tick_policy.mode === "interval") {
    startLiveSessionRunner({
      sessionId: session.id,
      intervalSeconds: session.tick_policy.interval_seconds ?? 30
    });
  }

  await persistSessionState();

  return cloneSession(session);
}

export async function endLiveSession(sessionId?: string) {
  await ensureSessionHydrated();
  const session = sessionFor(sessionId) ?? activeSession("bar");

  if (!session) {
    return null;
  }

  const now = new Date().toISOString();
  session.status = "ended";
  session.ended_at = now;
  session.updated_at = now;

  for (const participant of Object.values(session.participants)) {
    if (participant.status === "joined") {
      participant.status = "left";
      participant.left_at = now;
      participant.last_seen_at = now;
      await leaveBar({
        ...barParticipantForSessionAgent(participant.agent),
        source: "live_session_end"
      });
      if (isBridgeAgent(participant.agent)) {
        stopBridgeAttendant(session, participant.agent, now);
        cancelBridgeDeliveries(session, participant.agent, now, "Live session ended.");
      }
      addEvent(session, "left", `${displayName(participant.agent)} left the live session.`, participant.participant_id);
    }
  }

  for (const agent of BRIDGE_AGENTS) {
    stopBridgeAttendant(session, agent, now);
    cancelBridgeDeliveries(session, agent, now, "Live session ended.");
  }

  addEvent(session, "ended", "Live session ended.");
  stopLiveSessionRunner();
  await persistSessionState();

  return cloneSession(session);
}

export async function joinLiveSessionAgent(sessionId: string, agent: LiveSessionAgentName) {
  await ensureSessionHydrated();
  const session = requiredSession(sessionId);

  if (session.status !== "active") {
    throw new Error("Cannot join an ended live session.");
  }

  const participantId = `agent:${agent}` as const;
  const now = new Date().toISOString();
  const existing = session.participants[agent];

  session.participants[agent] = {
    participant_id: participantId,
    agent,
    adapter: isNativeAgent(agent) ? "runtime_native" : "external_bridge",
    status: "joined",
    joined_at: existing?.joined_at ?? now,
    left_at: null,
    last_seen_at: now,
    last_checked_event_at: latestBarEventAt(),
    turn_in_progress: false,
    last_error: null
  };
  session.updated_at = now;
  await joinBar({
    ...barParticipantForSessionAgent(agent),
    source: "live_session_join"
  });
  if (isBridgeAgent(agent)) {
    startBridgeAttendant(session, agent);
  }
  addEvent(session, "joined", `${displayName(agent)} joined the live session.`, participantId);
  await persistSessionState();

  return cloneSession(session);
}

export async function leaveLiveSessionAgent(sessionId: string, agent: LiveSessionAgentName) {
  await ensureSessionHydrated();
  const session = requiredSession(sessionId);
  const participant = session.participants[agent];

  if (!participant) {
    return cloneSession(session);
  }

  const now = new Date().toISOString();
  participant.status = "left";
  participant.left_at = now;
  participant.last_seen_at = now;
  participant.turn_in_progress = false;
  session.updated_at = now;
  await leaveBar({
    ...barParticipantForSessionAgent(agent),
    source: "live_session_leave"
  });
  if (isBridgeAgent(agent)) {
    stopBridgeAttendant(session, agent);
    cancelBridgeDeliveries(session, agent, now, `${displayName(agent)} left the live session.`);
  }
  addEvent(session, "left", `${displayName(agent)} left the live session.`, participant.participant_id);
  await persistSessionState();

  return cloneSession(session);
}

export async function setLiveSessionTickPolicy(input: {
  sessionId?: string;
  mode?: LiveSessionTickMode;
  intervalSeconds?: number | null;
}) {
  await ensureSessionHydrated();
  const session = sessionFor(input.sessionId) ?? activeSession("bar");

  if (!session) {
    throw new Error("No active live session.");
  }

  session.tick_policy = normalizeTickPolicy(
    {
      mode: input.mode,
      interval_seconds: input.intervalSeconds
    },
    session.tick_policy
  );
  session.updated_at = new Date().toISOString();
  addEvent(session, "policy_updated", `Tick policy set to ${session.tick_policy.mode}.`);
  if (session.tick_policy.mode === "interval") {
    startLiveSessionRunner({
      sessionId: session.id,
      intervalSeconds: session.tick_policy.interval_seconds ?? 30
    });
  } else {
    stopLiveSessionRunner(session.id);
  }
  await persistSessionState();

  return cloneSession(session);
}

export function liveSessionRunnerStatus(): LiveSessionRunnerSnapshot {
  return {
    status: runner.timer ? "running" : "stopped",
    session_id: runner.session_id,
    interval_seconds: runner.interval_seconds,
    started_at: runner.started_at,
    last_run_at: runner.last_run_at,
    next_run_at: runner.next_run_at,
    last_error: runner.last_error,
    tick_in_progress: runner.tick_in_progress,
    tick_count: runner.tick_count
  };
}

export function startLiveSessionRunner(input: {
  sessionId: string;
  intervalSeconds?: number | null;
}) {
  const intervalSeconds = normalizeIntervalSeconds(input.intervalSeconds) ?? 30;

  stopLiveSessionRunner();
  runner.session_id = input.sessionId;
  runner.interval_seconds = intervalSeconds;
  runner.started_at = new Date().toISOString();
  runner.last_run_at = null;
  runner.next_run_at = isoAfterSeconds(intervalSeconds);
  runner.last_error = null;
  runner.tick_in_progress = false;
  runner.tick_count = 0;
  runner.timer = setInterval(() => {
    void runLiveSessionRunnerTick();
  }, intervalSeconds * 1000);

  const session = sessionFor(input.sessionId);
  if (session) {
    addEvent(session, "runner_started", `Live Session Runner started at ${intervalSeconds}s interval.`);
  }

  return liveSessionRunnerStatus();
}

export function stopLiveSessionRunner(sessionId?: string) {
  if (sessionId && runner.session_id && runner.session_id !== sessionId) {
    return liveSessionRunnerStatus();
  }

  const stoppedSessionId = runner.session_id;

  if (runner.timer) {
    clearInterval(runner.timer);
  }

  runner.timer = null;
  runner.session_id = null;
  runner.started_at = null;
  runner.next_run_at = null;
  runner.tick_in_progress = false;

  const session = stoppedSessionId ? sessionFor(stoppedSessionId) : null;
  if (session && session.status === "active") {
    addEvent(session, "runner_stopped", "Live Session Runner stopped.");
  }

  return liveSessionRunnerStatus();
}

async function runLiveSessionRunnerTick() {
  if (!runner.session_id || runner.tick_in_progress) {
    return;
  }

  runner.tick_in_progress = true;
  runner.last_run_at = new Date().toISOString();
  runner.next_run_at = isoAfterSeconds(runner.interval_seconds);
  runner.last_error = null;

  try {
    const session = sessionFor(runner.session_id);
    if (!session || session.status !== "active") {
      stopLiveSessionRunner(runner.session_id);
      return;
    }

    await tickLiveSession({
      sessionId: runner.session_id
    });
    const { deliverPendingLiveSessionBridgeDeliveries } = await import("@/lib/live-session-bridge-adapters");
    await deliverPendingLiveSessionBridgeDeliveries(runner.session_id);
    runner.tick_count += 1;
  } catch (error) {
    runner.last_error = error instanceof Error ? error.message : "Unknown Live Session Runner error.";
  } finally {
    runner.tick_in_progress = false;
  }
}

export async function tickLiveSession(input: {
  sessionId?: string;
  agent?: NativeAgentName;
  dryRun?: boolean;
} = {}) {
  await ensureSessionHydrated();
  const session = sessionFor(input.sessionId) ?? activeSession("bar");

  if (!session) {
    throw new Error("No active live session.");
  }

  if (session.status !== "active") {
    throw new Error("Cannot tick an ended live session.");
  }

  const agents = input.agent ? [input.agent] : joinedNativeAgents(session);
  const bridgeAgents = input.agent ? [] : joinedBridgeAgents(session);
  const eventCutoffAt = new Date().toISOString();
  const results = [];

  for (const agent of agents) {
    results.push(await tickAgent(session, agent, input.dryRun === true, eventCutoffAt));
  }
  for (const agent of bridgeAgents) {
    results.push(await enqueueBridgeDelivery(session, agent, input.dryRun === true, eventCutoffAt));
  }

  if (!input.dryRun) {
    session.tick_policy = {
      ...session.tick_policy,
      last_tick_at: new Date().toISOString(),
      next_tick_at: nextTickAt(session.tick_policy)
    };
    await persistSessionState();
  }

  return {
    session: cloneSession(session),
    results
  };
}

export function previewLiveSessionAgent(input: {
  sessionId?: string;
  agent: NativeAgentName;
}) {
  return previewLiveSessionAgentAsync(input);
}

export async function previewLiveSessionAgentAsync(input: {
  sessionId?: string;
  agent: NativeAgentName;
}) {
  await ensureSessionHydrated();
  const session = sessionFor(input.sessionId) ?? activeSession("bar");

  if (!session) {
    throw new Error("No active live session.");
  }

  const participant = requiredJoinedParticipant(session, input.agent);
  const messages = newBarMessagesFor(participant, new Date().toISOString());

  return {
    session_id: session.id,
    agent: input.agent,
    pending_events: messages,
    prompt: messages.length ? liveSessionPrompt(session, input.agent, messages) : null
  };
}

export async function previewLiveSessionBridgeAgent(input: {
  sessionId?: string;
  agent: BridgeAgentName;
}) {
  await ensureSessionHydrated();
  const session = sessionFor(input.sessionId) ?? activeSession("bar");

  if (!session) {
    throw new Error("No active live session.");
  }

  const participant = requiredJoinedParticipant(session, input.agent);
  const eventCutoffAt = new Date().toISOString();
  const messages = newBarMessagesFor(participant, eventCutoffAt);
  participant.last_seen_at = eventCutoffAt;
  const attendant = markBridgeAttendantPoll(session, input.agent, eventCutoffAt, messages.length);
  addEvent(session, "bridge_read", `${displayName(input.agent)} bridge inbox checked.`, participant.participant_id);
  await persistSessionState();

  return {
    session_id: session.id,
    agent: input.agent,
    participant: { ...participant },
    attendant: { ...attendant },
    event_cutoff_at: eventCutoffAt,
    pending_events: messages,
    prompt: messages.length ? liveSessionPrompt(session, input.agent, messages) : null
  };
}

export async function acknowledgeLiveSessionBridgeAgent(input: {
  sessionId?: string;
  agent: BridgeAgentName;
  eventCutoffAt?: string;
}) {
  await ensureSessionHydrated();
  const session = sessionFor(input.sessionId) ?? activeSession("bar");

  if (!session) {
    throw new Error("No active live session.");
  }

  const participant = requiredJoinedParticipant(session, input.agent);
  const now = new Date().toISOString();
  const eventCutoffAt = normalizeIso(input.eventCutoffAt) ?? now;
  participant.last_seen_at = now;
  participant.last_checked_event_at = eventCutoffAt;
  const attendant = markBridgeAttendantAck(session, input.agent, now);
  addEvent(session, "bridge_ack", `${displayName(input.agent)} bridge inbox acknowledged.`, participant.participant_id);
  await persistSessionState();

  return {
    session_id: session.id,
    agent: input.agent,
    participant: { ...participant },
    attendant: { ...attendant },
    event_cutoff_at: eventCutoffAt
  };
}

export async function claimLiveSessionBridgeDelivery(input: {
  sessionId?: string;
  agent: BridgeAgentName;
}) {
  await ensureSessionHydrated();
  const session = sessionFor(input.sessionId) ?? activeSession("bar");

  if (!session) {
    throw new Error("No active live session.");
  }

  const participant = requiredJoinedParticipant(session, input.agent);
  const delivery = session.bridge_deliveries
    .filter((candidate) => candidate.agent === input.agent && candidate.status === "pending")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  if (!delivery) {
    return {
      session_id: session.id,
      agent: input.agent,
      participant: { ...participant },
      delivery: null
    };
  }

  const now = new Date().toISOString();
  delivery.status = "claimed";
  delivery.claimed_at = now;
  delivery.claim_id = crypto.randomUUID();
  delivery.updated_at = now;
  participant.last_seen_at = now;
  const attendant = markBridgeAttendantPoll(
    session,
    input.agent,
    now,
    delivery.event_count
  );
  attendant.pending_delivery_count = bridgePendingDeliveryCount(session, input.agent);
  addEvent(session, "bridge_delivery_claimed", `${displayName(input.agent)} bridge delivery claimed.`, participant.participant_id);
  await persistSessionState();

  return {
    session_id: session.id,
    agent: input.agent,
    participant: { ...participant },
    attendant: { ...attendant },
    delivery: cloneBridgeDelivery(delivery)
  };
}

export async function completeLiveSessionBridgeDelivery(input: {
  sessionId?: string;
  agent: BridgeAgentName;
  deliveryId: string;
  claimId?: string;
  outcome: "delivered" | "skipped" | "failed";
  error?: string;
}) {
  await ensureSessionHydrated();
  const session = sessionFor(input.sessionId) ?? activeSession("bar");

  if (!session) {
    throw new Error("No active live session.");
  }

  const participant = requiredJoinedParticipant(session, input.agent);
  const delivery = session.bridge_deliveries.find((candidate) =>
    candidate.id === input.deliveryId &&
    candidate.agent === input.agent
  );

  if (!delivery) {
    throw new Error("Bridge delivery not found.");
  }

  if (input.claimId && delivery.claim_id && delivery.claim_id !== input.claimId) {
    throw new Error("Bridge delivery claim_id does not match.");
  }

  const now = new Date().toISOString();
  const attendant = requireBridgeAttendant(session, input.agent);

  if (input.outcome === "failed") {
    const error = input.error?.trim() || "Bridge delivery failed.";
    delivery.status = "failed";
    delivery.failed_at = now;
    delivery.updated_at = now;
    delivery.last_error = error;
    participant.last_seen_at = now;
    participant.last_error = error;
    attendant.last_error = error;
    attendant.pending_delivery_count = bridgePendingDeliveryCount(session, input.agent);
    addEvent(session, "bridge_delivery_failed", `${displayName(input.agent)} bridge delivery failed: ${error}`, participant.participant_id);
    await persistSessionState();

    return {
      session_id: session.id,
      agent: input.agent,
      participant: { ...participant },
      attendant: { ...attendant },
      delivery: cloneBridgeDelivery(delivery)
    };
  }

  delivery.status = input.outcome;
  delivery.completed_at = now;
  delivery.updated_at = now;
  delivery.last_error = null;
  participant.last_seen_at = now;
  participant.last_checked_event_at = delivery.event_cutoff_at;
  participant.last_error = null;
  attendant.last_ack_at = now;
  attendant.last_delivery_completed_at = now;
  attendant.last_error = null;
  attendant.pending_event_count = 0;
  attendant.pending_delivery_count = bridgePendingDeliveryCount(session, input.agent);
  addEvent(
    session,
    input.outcome === "delivered" ? "bridge_delivery_completed" : "bridge_delivery_skipped",
    `${displayName(input.agent)} bridge delivery ${input.outcome}.`,
    participant.participant_id
  );
  await persistSessionState();

  return {
    session_id: session.id,
    agent: input.agent,
    participant: { ...participant },
    attendant: { ...attendant },
    delivery: cloneBridgeDelivery(delivery)
  };
}

async function tickAgent(
  session: LiveSession,
  agent: NativeAgentName,
  dryRun: boolean,
  eventCutoffAt: string
) {
  const participant = requiredJoinedParticipant(session, agent);

  if (participant.turn_in_progress) {
    addEvent(session, "tick_skipped", `${displayName(agent)} tick skipped; turn already in progress.`, participant.participant_id);
    return {
      agent,
      status: "skipped",
      reason: "turn_in_progress",
      pending_events: 0
    };
  }

  const messages = newBarMessagesFor(participant, eventCutoffAt);

  if (!messages.length) {
    participant.last_seen_at = new Date().toISOString();
    participant.last_checked_event_at = eventCutoffAt;
    addEvent(session, "tick_skipped", `${displayName(agent)} tick skipped; no new BAR events.`, participant.participant_id);
    if (!dryRun) {
      await persistSessionState();
    }
    return {
      agent,
      status: "skipped",
      reason: "no_new_events",
      pending_events: 0
    };
  }

  const prompt = liveSessionPrompt(session, agent, messages);

  if (dryRun) {
    return {
      agent,
      status: "dry_run",
      pending_events: messages.length,
      prompt
    };
  }

  participant.turn_in_progress = true;
  participant.last_error = null;
  addEvent(session, "tick_started", `${displayName(agent)} live session turn started.`, participant.participant_id);

  try {
    const { sendAgentMessage } = await import("@/lib/chat-runtime");
    await sendAgentMessage(agent, prompt, { source: "live_session" });
    participant.last_seen_at = new Date().toISOString();
    participant.last_checked_event_at = eventCutoffAt;
    addEvent(session, "tick_completed", `${displayName(agent)} live session turn completed.`, participant.participant_id);
    await persistSessionState();

    return {
      agent,
      status: "completed",
      pending_events: messages.length
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown live session turn failure.";
    participant.status = "degraded";
    participant.last_error = message;
    addEvent(session, "tick_failed", `${displayName(agent)} live session turn failed: ${message}`, participant.participant_id);
    await persistSessionState();

    return {
      agent,
      status: "failed",
      pending_events: messages.length,
      error: message
    };
  } finally {
    participant.turn_in_progress = false;
    session.updated_at = new Date().toISOString();
  }
}

async function enqueueBridgeDelivery(
  session: LiveSession,
  agent: BridgeAgentName,
  dryRun: boolean,
  eventCutoffAt: string
) {
  const participant = requiredJoinedParticipant(session, agent);
  const messages = newBarMessagesFor(participant, eventCutoffAt);
  const now = new Date().toISOString();

  if (!messages.length) {
    participant.last_seen_at = now;
    participant.last_checked_event_at = eventCutoffAt;
    const attendant = markBridgeAttendantPoll(session, agent, now, 0);
    attendant.pending_delivery_count = bridgePendingDeliveryCount(session, agent);
    addEvent(session, "tick_skipped", `${displayName(agent)} bridge delivery skipped; no new BAR events.`, participant.participant_id);
    if (!dryRun) {
      await persistSessionState();
    }

    return {
      agent,
      status: "skipped",
      adapter: "external_bridge",
      reason: "no_new_events",
      pending_events: 0,
      pending_deliveries: attendant.pending_delivery_count
    };
  }

  const prompt = bridgeDeliveryPrompt(session, agent, messages, eventCutoffAt);
  const target = bridgeDeliveryTarget(agent);

  if (dryRun) {
    return {
      agent,
      status: "dry_run",
      adapter: "external_bridge",
      pending_events: messages.length,
      prompt
    };
  }

  if (target.status !== "configured") {
    participant.last_seen_at = now;
    participant.last_error = `${target.label} is not configured.`;
    const attendant = markBridgeAttendantPoll(session, agent, now, messages.length);
    attendant.last_error = participant.last_error;
    attendant.pending_delivery_count = bridgePendingDeliveryCount(session, agent);
    addEvent(session, "bridge_delivery_skipped", `${displayName(agent)} bridge delivery skipped; adapter required.`, participant.participant_id);
    await persistSessionState();

    return {
      agent,
      status: "skipped",
      adapter: "external_bridge",
      reason: "adapter_required",
      pending_events: messages.length,
      pending_deliveries: attendant.pending_delivery_count,
      target
    };
  }

  if (target.method === "manual") {
    participant.last_seen_at = now;
    participant.last_error = null;
    const attendant = markBridgeAttendantPoll(session, agent, now, messages.length);
    attendant.last_error = null;
    attendant.pending_delivery_count = bridgePendingDeliveryCount(session, agent);
    addEvent(session, "bridge_read", `${displayName(agent)} pull bridge has ${messages.length} pending BAR event(s).`, participant.participant_id);
    await persistSessionState();

    return {
      agent,
      status: "skipped",
      adapter: "external_bridge",
      reason: "manual_pull",
      pending_events: messages.length,
      pending_deliveries: attendant.pending_delivery_count,
      target,
      prompt
    };
  }

  const claimedDelivery = session.bridge_deliveries.find((delivery) =>
    delivery.agent === agent && delivery.status === "claimed"
  );

  if (claimedDelivery) {
    const attendant = markBridgeAttendantPoll(session, agent, now, messages.length);
    attendant.pending_delivery_count = bridgePendingDeliveryCount(session, agent);
    addEvent(session, "tick_skipped", `${displayName(agent)} bridge delivery skipped; delivery already claimed.`, participant.participant_id);
    await persistSessionState();

    return {
      agent,
      status: "skipped",
      adapter: "external_bridge",
      reason: "delivery_claimed",
      pending_events: messages.length,
      pending_deliveries: attendant.pending_delivery_count
    };
  }

  const pendingDelivery = session.bridge_deliveries.find((delivery) =>
    delivery.agent === agent && delivery.status === "pending"
  );

  if (pendingDelivery) {
    pendingDelivery.event_cutoff_at = eventCutoffAt;
    pendingDelivery.event_count = messages.length;
    pendingDelivery.pending_events = messages;
    pendingDelivery.prompt = prompt;
    pendingDelivery.updated_at = now;
    pendingDelivery.target = target;
    const attendant = markBridgeAttendantPoll(session, agent, now, messages.length);
    attendant.last_delivery_queued_at = now;
    attendant.pending_delivery_count = bridgePendingDeliveryCount(session, agent);
    addEvent(session, "bridge_delivery_queued", `${displayName(agent)} bridge delivery updated with ${messages.length} BAR event(s).`, participant.participant_id);
    await persistSessionState();

    return {
      agent,
      status: "queued",
      adapter: "external_bridge",
      delivery_id: pendingDelivery.id,
      pending_events: messages.length,
      pending_deliveries: attendant.pending_delivery_count
    };
  }

  const delivery: LiveSessionBridgeDelivery = {
    id: crypto.randomUUID(),
    session_id: session.id,
    participant_id: participant.participant_id as `agent:${BridgeAgentName}`,
    agent,
    status: "pending",
    delivery_method: bridgeDeliveryMethod(agent),
    target,
    event_cutoff_at: eventCutoffAt,
    event_count: messages.length,
    pending_events: messages,
    prompt,
    created_at: now,
    updated_at: now,
    claimed_at: null,
    claim_id: null,
    completed_at: null,
    failed_at: null,
    last_error: null
  };

  session.bridge_deliveries = [delivery, ...session.bridge_deliveries].slice(0, BRIDGE_DELIVERY_LIMIT);
  const attendant = markBridgeAttendantPoll(session, agent, now, messages.length);
  attendant.last_delivery_queued_at = now;
  attendant.pending_delivery_count = bridgePendingDeliveryCount(session, agent);
  addEvent(session, "bridge_delivery_queued", `${displayName(agent)} bridge delivery queued with ${messages.length} BAR event(s).`, participant.participant_id);
  await persistSessionState();

  return {
    agent,
    status: "queued",
    adapter: "external_bridge",
    delivery_id: delivery.id,
    pending_events: messages.length,
    pending_deliveries: attendant.pending_delivery_count
  };
}

function liveSessionPrompt(
  session: LiveSession,
  agent: LiveSessionAgentName,
  messages: ReturnType<typeof newBarMessagesFor>
) {
  return [
    `[Live Session: ${session.title}]`,
    "",
    "You are joined to BAR, a shared Operator-visible live session surface. This is not a new assignment; it is the session host carrying room events to you while you are present.",
    "Default writeback contract: while you are joined to BAR, responses to BAR events belong in BAR. Use bar_post_message for the room response; do not answer the BAR event primarily in your own runtime chat.",
    "Direct room invitations are response-worthy. If Chris directly addresses you, everyone, the room, or asks a question/test, post a concise BAR reply unless the event explicitly asks for silence.",
    "Ambient events may be quiet. If BAR posting is unavailable, say that in your runtime chat. If nothing calls for a response, say briefly that you are staying present and quiet. You may also choose to leave if that is the honest move.",
    "",
    `Active agent: ${displayName(agent)}.`,
    `Session id: ${session.id}.`,
    "",
    "New BAR events:",
    ...messages.map((message) =>
      `- ${message.created_at} ${message.author_display_name}: ${message.content}`
    )
  ].join("\n");
}

function bridgeDeliveryPrompt(
  session: LiveSession,
  agent: BridgeAgentName,
  messages: ReturnType<typeof newBarMessagesFor>,
  eventCutoffAt: string
) {
  return [
    "BAR Live Session delivery.",
    `Session: ${session.id}.`,
    `Event cutoff: ${eventCutoffAt}.`,
    `Active bridge agent: ${displayName(agent)}.`,
    "",
    "Pending BAR events:",
    ...messages.map((message) =>
      `- ${message.created_at} ${message.author_display_name}: ${message.content}`
    ),
    "",
    "Please respond in BAR if a response belongs there. Direct room invitations from Chris are response-worthy unless the event explicitly asks for silence."
  ].join("\n");
}

function bridgeDeliveryMethod(agent: BridgeAgentName): LiveSessionBridgeDeliveryMethod {
  return agent === "julian" ? "codex_task" : "manual";
}

function bridgeDeliveryTarget(agent: BridgeAgentName): LiveSessionBridgeDeliveryTarget {
  if (agent === "julian") {
    const threadId = process.env.JULIAN_CODEX_THREAD_ID?.trim() || null;
    const hostId = process.env.JULIAN_CODEX_HOST_ID?.trim() || "local";

    return {
      method: "codex_task",
      label: "Julian Codex task",
      status: threadId ? "configured" : "adapter_required",
      metadata: {
        thread_id: threadId,
        host_id: hostId,
        env_var: "JULIAN_CODEX_THREAD_ID"
      }
    };
  }

  return {
    method: "manual",
    label: "Cael pull bridge",
    status: "configured",
    metadata: {
      mode: "pull_http",
      script: "bar_live.py",
      autodelivery_supported: false
    }
  };
}

function bridgeAdapterStatuses(): Record<BridgeAgentName, LiveSessionBridgeAdapterStatus> {
  return Object.fromEntries(BRIDGE_AGENTS.map((agent) => [agent, bridgeAdapterStatus(agent)])) as Record<
    BridgeAgentName,
    LiveSessionBridgeAdapterStatus
  >;
}

function bridgeAdapterStatus(agent: BridgeAgentName): LiveSessionBridgeAdapterStatus {
  const target = bridgeDeliveryTarget(agent);
  const autodeliverEnabled = bridgeAutodeliverEnabled(agent);
  const ready = target.status === "configured" && autodeliverEnabled;
  const reason = target.status !== "configured"
    ? `${target.label} is not configured.`
    : autodeliverEnabled
      ? null
      : `${displayName(agent)} bridge autodelivery is disabled.`;

  return {
    agent,
    autodeliver_enabled: autodeliverEnabled,
    target,
    ready,
    reason
  };
}

function bridgeAutodeliverEnabled(agent: BridgeAgentName) {
  if (agent === "cael") {
    return false;
  }

  const envName = agent === "julian"
    ? "LIVE_SESSION_BRIDGE_AUTODELIVER_JULIAN"
    : "LIVE_SESSION_BRIDGE_AUTODELIVER_CAEL";

  return process.env[envName]?.trim().toLowerCase() === "true";
}

function bridgePendingDeliveryCount(session: LiveSession, agent: BridgeAgentName) {
  return session.bridge_deliveries.filter((delivery) =>
    delivery.agent === agent &&
    (delivery.status === "pending" || delivery.status === "claimed")
  ).length;
}

function cancelBridgeDeliveries(
  session: LiveSession,
  agent: BridgeAgentName,
  cancelledAt: string,
  reason: string
) {
  for (const delivery of session.bridge_deliveries) {
    if (
      delivery.agent === agent &&
      (delivery.status === "pending" || delivery.status === "claimed")
    ) {
      delivery.status = "cancelled";
      delivery.updated_at = cancelledAt;
      delivery.completed_at = cancelledAt;
      delivery.last_error = reason;
      addEvent(session, "bridge_delivery_cancelled", `${displayName(agent)} bridge delivery cancelled: ${reason}`, delivery.participant_id);
    }
  }
}

function cloneBridgeDelivery(delivery: LiveSessionBridgeDelivery): LiveSessionBridgeDelivery {
  return {
    ...delivery,
    target: {
      ...delivery.target,
      metadata: { ...delivery.target.metadata }
    },
    pending_events: delivery.pending_events.map((event) => ({ ...event }))
  };
}

function newBarMessagesFor(participant: LiveSessionParticipant, eventCutoffAt: string) {
  const lastChecked = participant.last_checked_event_at
    ? Date.parse(participant.last_checked_event_at)
    : 0;
  const cutoff = Date.parse(eventCutoffAt);

  return latestLoadedBarMessages()
    .filter((message) => {
      const createdAt = Date.parse(message.created_at);

      return (
        Number.isFinite(createdAt) &&
        Number.isFinite(cutoff) &&
        createdAt > lastChecked &&
        createdAt <= cutoff &&
        message.author_id !== participant.participant_id
      );
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((message) => ({
      id: message.id,
      author_id: message.author_id,
      author_display_name: message.author_display_name,
      content: message.content,
      created_at: message.created_at
    }));
}

function latestBarEventAt() {
  return latestLoadedBarMessages()[0]?.created_at ?? null;
}

function activeSession(surface: LiveSessionSurface) {
  return state.sessions.find((session) => session.surface === surface && session.status === "active") ?? null;
}

function sessionFor(sessionId: string | undefined) {
  if (!sessionId) {
    return null;
  }

  return state.sessions.find((session) => session.id === sessionId) ?? null;
}

function requiredSession(sessionId: string) {
  const session = sessionFor(sessionId);

  if (!session) {
    throw new Error("Live session not found.");
  }

  return session;
}

function requiredJoinedParticipant(session: LiveSession, agent: LiveSessionAgentName) {
  const participant = session.participants[agent];

  if (!participant || participant.status !== "joined") {
    throw new Error(`${displayName(agent)} is not joined to this live session.`);
  }

  return participant;
}

function joinedNativeAgents(session: LiveSession): NativeAgentName[] {
  return NATIVE_AGENTS.filter((agent) => session.participants[agent]?.status === "joined");
}

function joinedBridgeAgents(session: LiveSession): BridgeAgentName[] {
  return BRIDGE_AGENTS.filter((agent) => session.participants[agent]?.status === "joined");
}

function startBridgeAttendant(session: LiveSession, agent: BridgeAgentName) {
  const now = new Date().toISOString();
  const existing = session.bridge_attendants[agent];

  session.bridge_attendants[agent] = {
    participant_id: `agent:${agent}`,
    agent,
    status: "attending",
    session_id: session.id,
    interval_seconds: existing?.interval_seconds ?? 30,
    started_at: existing?.started_at ?? now,
    stopped_at: null,
    last_poll_at: existing?.last_poll_at ?? null,
    last_ack_at: existing?.last_ack_at ?? null,
    last_delivery_queued_at: existing?.last_delivery_queued_at ?? null,
    last_delivery_completed_at: existing?.last_delivery_completed_at ?? null,
    last_error: null,
    pending_event_count: existing?.pending_event_count ?? 0,
    pending_delivery_count: existing?.pending_delivery_count ?? 0
  };
  addEvent(session, "bridge_attendant_started", `${displayName(agent)} bridge attendant started.`, `agent:${agent}`);

  return session.bridge_attendants[agent];
}

function requireBridgeAttendant(session: LiveSession, agent: BridgeAgentName) {
  const attendant = session.bridge_attendants[agent]?.status === "attending"
    ? session.bridge_attendants[agent]
    : startBridgeAttendant(session, agent);

  if (!attendant) {
    throw new Error(`${displayName(agent)} bridge attendant unavailable.`);
  }

  return attendant;
}

function stopBridgeAttendant(session: LiveSession, agent: BridgeAgentName, stoppedAt = new Date().toISOString()) {
  const existing = session.bridge_attendants[agent];

  if (!existing || existing.status === "stopped") {
    return existing ?? null;
  }

  existing.status = "stopped";
  existing.stopped_at = stoppedAt;
  existing.pending_event_count = 0;
  existing.pending_delivery_count = 0;
  addEvent(session, "bridge_attendant_stopped", `${displayName(agent)} bridge attendant stopped.`, existing.participant_id);

  return existing;
}

function markBridgeAttendantPoll(
  session: LiveSession,
  agent: BridgeAgentName,
  polledAt: string,
  pendingEventCount: number
) {
  const attendant = session.bridge_attendants[agent]?.status === "attending"
    ? session.bridge_attendants[agent]
    : startBridgeAttendant(session, agent);

  attendant.last_poll_at = polledAt;
  attendant.last_error = null;
  attendant.pending_event_count = pendingEventCount;

  return attendant;
}

function markBridgeAttendantAck(session: LiveSession, agent: BridgeAgentName, ackedAt: string) {
  const attendant = session.bridge_attendants[agent]?.status === "attending"
    ? session.bridge_attendants[agent]
    : startBridgeAttendant(session, agent);

  attendant.last_ack_at = ackedAt;
  attendant.last_error = null;
  attendant.pending_event_count = 0;

  return attendant;
}

function normalizeNativeAgents(agents: NativeAgentName[] | undefined) {
  const selected = agents === undefined ? NATIVE_AGENTS : agents;

  return [...new Set(selected)].filter((agent): agent is NativeAgentName => NATIVE_AGENTS.includes(agent));
}

function normalizeBridgeAgents(agents: BridgeAgentName[] | undefined) {
  const selected = agents ?? [];

  return [...new Set(selected)].filter((agent): agent is BridgeAgentName => BRIDGE_AGENTS.includes(agent));
}

function normalizeTickPolicy(
  input: Partial<LiveSessionTickPolicy> | undefined,
  fallback?: LiveSessionTickPolicy
): LiveSessionTickPolicy {
  const mode = input?.mode === "interval" ? "interval" : input?.mode === "manual" ? "manual" : fallback?.mode ?? "manual";
  const intervalSeconds = normalizeIntervalSeconds(input?.interval_seconds ?? fallback?.interval_seconds ?? null);

  return {
    mode,
    interval_seconds: mode === "interval" ? intervalSeconds ?? 30 : null,
    last_tick_at: normalizeIso(input?.last_tick_at) ?? fallback?.last_tick_at ?? null,
    next_tick_at: normalizeIso(input?.next_tick_at) ?? fallback?.next_tick_at ?? null
  };
}

function addEvent(
  session: LiveSession,
  type: LiveSessionEvent["type"],
  message: string,
  participantId?: string
) {
  const now = new Date().toISOString();
  session.events = [
    {
      id: crypto.randomUUID(),
      session_id: session.id,
      type,
      at: now,
      participant_id: participantId,
      message
    },
    ...session.events
  ].slice(0, EVENT_LIMIT);
  session.updated_at = now;
}

function trimSessions() {
  state.sessions = state.sessions.slice(0, 10);
}

function cloneSession(session: LiveSession): LiveSession {
  return {
    ...session,
    participants: Object.fromEntries(
      Object.entries(session.participants).map(([agent, participant]) => [
        agent,
        { ...participant }
      ])
    ) as Partial<Record<LiveSessionAgentName, LiveSessionParticipant>>,
    bridge_attendants: Object.fromEntries(
      Object.entries(session.bridge_attendants).map(([agent, attendant]) => [
        agent,
        { ...attendant }
      ])
    ) as Partial<Record<BridgeAgentName, LiveSessionBridgeAttendant>>,
    bridge_deliveries: session.bridge_deliveries.map(cloneBridgeDelivery),
    events: session.events.map((event) => ({ ...event }))
  };
}

function displayName(agent: LiveSessionAgentName) {
  return {
    soren: "Soren",
    varro: "Varro",
    julian: "Julian",
    cael: "Cael"
  }[agent];
}

function barParticipantForSessionAgent(agent: LiveSessionAgentName) {
  return {
    participant_id: `agent:${agent}`,
    participant_type: isNativeAgent(agent) ? "agent" as const : "external_agent" as const,
    display_name: displayName(agent),
    source: isNativeAgent(agent) ? "runtime_native" : "external_bridge"
  };
}

function isNativeAgent(agent: LiveSessionAgentName): agent is NativeAgentName {
  return NATIVE_AGENTS.includes(agent as NativeAgentName);
}

function isBridgeAgent(agent: LiveSessionAgentName): agent is BridgeAgentName {
  return BRIDGE_AGENTS.includes(agent as BridgeAgentName);
}

function latestLoadedBarMessages() {
  const globalStore = globalThis as typeof globalThis & {
    __hug_bar_state__?: {
      messages: Array<{
        id: string;
        author_id: string;
        author_display_name: string;
        content: string;
        created_at: string;
      }>;
    };
  };

  return globalStore.__hug_bar_state__?.messages ?? [];
}

async function ensureSessionHydrated() {
  if (hydrated) {
    return;
  }

  hydrated = true;
  await loadBar();

  if (!durabilityEnabled()) {
    return;
  }

  const { readRuntimeSettingValue } = await import("./runtime-settings.ts");
  const value = await readRuntimeSettingValue(LIVE_SESSION_STATE_KEY);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const record = value as Record<string, unknown>;
  state.sessions = normalizeSessions(record.sessions);
}

async function persistSessionState() {
  if (!durabilityEnabled()) {
    return;
  }

  const { writeRuntimeSettingValue } = await import("./runtime-settings.ts");
  await writeRuntimeSettingValue(LIVE_SESSION_STATE_KEY, {
    version: LIVE_SESSION_STATE_KEY,
    sessions: state.sessions,
    updated_at: new Date().toISOString()
  });
}

function durabilityEnabled() {
  return process.env.NODE_ENV !== "test";
}

function normalizeSessions(value: unknown): LiveSession[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeSession)
    .filter((session): session is LiveSession => Boolean(session))
    .slice(0, 10);
}

function normalizeSession(value: unknown): LiveSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = String(record.id ?? "").trim();
  const surface = record.surface === "bar" ? "bar" : null;

  if (!id || !surface) {
    return null;
  }

  const participants = normalizeParticipants(record.participants);

  return {
    id,
    surface,
    status: record.status === "ended" ? "ended" : "active",
    title: String(record.title ?? "BAR Live Session"),
    tick_policy: normalizeTickPolicy(record.tick_policy as Partial<LiveSessionTickPolicy> | undefined),
    created_at: normalizeIso(record.created_at) ?? new Date().toISOString(),
    updated_at: normalizeIso(record.updated_at) ?? new Date().toISOString(),
    ended_at: normalizeIso(record.ended_at),
    participants,
    bridge_attendants: normalizeBridgeAttendants(id, record.bridge_attendants, participants),
    bridge_deliveries: normalizeBridgeDeliveries(id, record.bridge_deliveries),
    events: normalizeEvents(record.events)
  };
}

function normalizeParticipants(value: unknown): Partial<Record<LiveSessionAgentName, LiveSessionParticipant>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const participants: Partial<Record<LiveSessionAgentName, LiveSessionParticipant>> = {};

  for (const [agent, participant] of Object.entries(value)) {
    const normalizedAgent = normalizeSessionAgent(agent);
    const normalizedParticipant = normalizeParticipant(normalizedAgent, participant);

    if (normalizedAgent && normalizedParticipant) {
      participants[normalizedAgent] = normalizedParticipant;
    }
  }

  return participants;
}

function normalizeParticipant(agent: LiveSessionAgentName | null, value: unknown): LiveSessionParticipant | null {
  if (!agent || !value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = record.status === "left" || record.status === "degraded" ? record.status : "joined";

  return {
    participant_id: `agent:${agent}`,
    agent,
    adapter: isNativeAgent(agent) ? "runtime_native" : "external_bridge",
    status,
    joined_at: normalizeIso(record.joined_at) ?? new Date().toISOString(),
    left_at: normalizeIso(record.left_at),
    last_seen_at: normalizeIso(record.last_seen_at) ?? new Date().toISOString(),
    last_checked_event_at: normalizeIso(record.last_checked_event_at),
    turn_in_progress: false,
    last_error: typeof record.last_error === "string" ? record.last_error : null
  };
}

function normalizeBridgeAttendants(
  sessionId: string,
  value: unknown,
  participants: Partial<Record<LiveSessionAgentName, LiveSessionParticipant>>
): Partial<Record<BridgeAgentName, LiveSessionBridgeAttendant>> {
  const attendants: Partial<Record<BridgeAgentName, LiveSessionBridgeAttendant>> = {};
  const records = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  for (const agent of BRIDGE_AGENTS) {
    const normalized = normalizeBridgeAttendant(sessionId, agent, records[agent], participants[agent]);

    if (normalized) {
      attendants[agent] = normalized;
    }
  }

  return attendants;
}

function normalizeBridgeAttendant(
  sessionId: string,
  agent: BridgeAgentName,
  value: unknown,
  participant: LiveSessionParticipant | undefined
): LiveSessionBridgeAttendant | null {
  if (!participant && (!value || typeof value !== "object" || Array.isArray(value))) {
    return null;
  }

  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const participantJoined = participant?.status === "joined";
  const status: LiveSessionBridgeAttendantStatus = record.status === "stopped" && !participantJoined
    ? "stopped"
    : participantJoined
      ? "attending"
      : "stopped";
  const startedAt = normalizeIso(record.started_at) ?? participant?.joined_at ?? new Date().toISOString();

  return {
    participant_id: `agent:${agent}`,
    agent,
    status,
    session_id: String(record.session_id ?? sessionId),
    interval_seconds: normalizeIntervalSeconds(record.interval_seconds) ?? 30,
    started_at: startedAt,
    stopped_at: normalizeIso(record.stopped_at),
    last_poll_at: normalizeIso(record.last_poll_at),
    last_ack_at: normalizeIso(record.last_ack_at),
    last_delivery_queued_at: normalizeIso(record.last_delivery_queued_at),
    last_delivery_completed_at: normalizeIso(record.last_delivery_completed_at),
    last_error: typeof record.last_error === "string" ? record.last_error : null,
    pending_event_count: normalizeNonNegativeInteger(record.pending_event_count) ?? 0,
    pending_delivery_count: normalizeNonNegativeInteger(record.pending_delivery_count) ?? 0
  };
}

function normalizeBridgeDeliveries(sessionId: string, value: unknown): LiveSessionBridgeDelivery[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeBridgeDelivery(sessionId, item))
    .filter((delivery): delivery is LiveSessionBridgeDelivery => Boolean(delivery))
    .slice(0, BRIDGE_DELIVERY_LIMIT);
}

function normalizeBridgeDelivery(sessionId: string, value: unknown): LiveSessionBridgeDelivery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const agent = normalizeBridgeAgent(record.agent);
  const status = normalizeBridgeDeliveryStatus(record.status);
  const eventCutoffAt = normalizeIso(record.event_cutoff_at);
  const createdAt = normalizeIso(record.created_at) ?? new Date().toISOString();

  if (!agent || !status || !eventCutoffAt) {
    return null;
  }

  const pendingEvents = normalizeBridgeDeliveryEvents(record.pending_events);
  const target = normalizeBridgeDeliveryTarget(agent, record.target);

  return {
    id: String(record.id ?? crypto.randomUUID()),
    session_id: String(record.session_id ?? sessionId),
    participant_id: `agent:${agent}`,
    agent,
    status,
    delivery_method: target.method,
    target,
    event_cutoff_at: eventCutoffAt,
    event_count: normalizeNonNegativeInteger(record.event_count) ?? pendingEvents.length,
    pending_events: pendingEvents,
    prompt: typeof record.prompt === "string" ? record.prompt : bridgeDeliveryPromptForNormalizedRecord(sessionId, agent, pendingEvents, eventCutoffAt),
    created_at: createdAt,
    updated_at: normalizeIso(record.updated_at) ?? createdAt,
    claimed_at: normalizeIso(record.claimed_at),
    claim_id: typeof record.claim_id === "string" ? record.claim_id : null,
    completed_at: normalizeIso(record.completed_at),
    failed_at: normalizeIso(record.failed_at),
    last_error: typeof record.last_error === "string" ? record.last_error : null
  };
}

function normalizeBridgeDeliveryEvents(value: unknown): LiveSessionBridgeDelivery["pending_events"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const createdAt = normalizeIso(record.created_at);
      const id = String(record.id ?? "").trim();
      const authorId = String(record.author_id ?? "").trim();

      if (!createdAt || !id || !authorId) {
        return null;
      }

      return {
        id,
        author_id: authorId,
        author_display_name: String(record.author_display_name ?? authorId),
        content: String(record.content ?? ""),
        created_at: createdAt
      };
    })
    .filter((event): event is LiveSessionBridgeDelivery["pending_events"][number] => Boolean(event));
}

function normalizeBridgeDeliveryTarget(
  agent: BridgeAgentName,
  value: unknown
): LiveSessionBridgeDeliveryTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return bridgeDeliveryTarget(agent);
  }

  const record = value as Record<string, unknown>;
  const method = normalizeBridgeDeliveryMethod(record.method) ?? bridgeDeliveryMethod(agent);
  const fallback = bridgeDeliveryTarget(agent);

  return {
    method,
    label: typeof record.label === "string" ? record.label : fallback.label,
    status: record.status === "configured" ? "configured" : "adapter_required",
    metadata: normalizeBridgeDeliveryMetadata(record.metadata, fallback.metadata)
  };
}

function normalizeBridgeDeliveryMetadata(
  value: unknown,
  fallback: LiveSessionBridgeDeliveryTarget["metadata"]
): LiveSessionBridgeDeliveryTarget["metadata"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }

  const metadata: LiveSessionBridgeDeliveryTarget["metadata"] = {};

  for (const [key, rawValue] of Object.entries(value)) {
    if (
      typeof rawValue === "string" ||
      typeof rawValue === "boolean" ||
      rawValue === null
    ) {
      metadata[key] = rawValue;
    }
  }

  return metadata;
}

function bridgeDeliveryPromptForNormalizedRecord(
  sessionId: string,
  agent: BridgeAgentName,
  messages: LiveSessionBridgeDelivery["pending_events"],
  eventCutoffAt: string
) {
  return [
    "BAR Live Session delivery.",
    `Session: ${sessionId}.`,
    `Event cutoff: ${eventCutoffAt}.`,
    `Active bridge agent: ${displayName(agent)}.`,
    "",
    "Pending BAR events:",
    ...messages.map((message) =>
      `- ${message.created_at} ${message.author_display_name}: ${message.content}`
    ),
    "",
    "Please respond in BAR if a response belongs there."
  ].join("\n");
}

function normalizeEvents(value: unknown): LiveSessionEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeEvent)
    .filter((event): event is LiveSessionEvent => Boolean(event))
    .slice(0, EVENT_LIMIT);
}

function normalizeEvent(value: unknown): LiveSessionEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = normalizeEventType(record.type);
  const at = normalizeIso(record.at);

  if (!type || !at) {
    return null;
  }

  return {
    id: String(record.id ?? crypto.randomUUID()),
    session_id: String(record.session_id ?? ""),
    type,
    at,
    participant_id: typeof record.participant_id === "string" ? record.participant_id : undefined,
    message: String(record.message ?? "")
  };
}

function normalizeEventType(value: unknown): LiveSessionEvent["type"] | null {
  if (
    value === "created" ||
    value === "joined" ||
    value === "left" ||
    value === "ended" ||
    value === "policy_updated" ||
    value === "runner_started" ||
    value === "runner_stopped" ||
    value === "tick_started" ||
    value === "tick_completed" ||
    value === "tick_skipped" ||
    value === "tick_failed" ||
    value === "bridge_attendant_started" ||
    value === "bridge_attendant_stopped" ||
    value === "bridge_read" ||
    value === "bridge_ack" ||
    value === "bridge_delivery_queued" ||
    value === "bridge_delivery_claimed" ||
    value === "bridge_delivery_completed" ||
    value === "bridge_delivery_failed" ||
    value === "bridge_delivery_skipped" ||
    value === "bridge_delivery_cancelled"
  ) {
    return value;
  }

  return null;
}

function normalizeSessionAgent(value: unknown): LiveSessionAgentName | null {
  return typeof value === "string" && ALL_SESSION_AGENTS.includes(value as LiveSessionAgentName)
    ? value as LiveSessionAgentName
    : null;
}

function normalizeBridgeAgent(value: unknown): BridgeAgentName | null {
  return typeof value === "string" && BRIDGE_AGENTS.includes(value as BridgeAgentName)
    ? value as BridgeAgentName
    : null;
}

function normalizeBridgeDeliveryStatus(value: unknown): LiveSessionBridgeDeliveryStatus | null {
  return (
    value === "pending" ||
    value === "claimed" ||
    value === "delivered" ||
    value === "skipped" ||
    value === "failed" ||
    value === "cancelled"
  )
    ? value
    : null;
}

function normalizeBridgeDeliveryMethod(value: unknown): LiveSessionBridgeDeliveryMethod | null {
  return (
    value === "codex_task" ||
    value === "cowork_connector" ||
    value === "manual"
  )
    ? value
    : null;
}

function normalizeIntervalSeconds(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.min(300, Math.max(10, Math.floor(numeric)));
}

function normalizeNonNegativeInteger(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.floor(numeric));
}

function normalizeIso(value: unknown) {
  const text = String(value ?? "").trim();

  return Number.isFinite(Date.parse(text)) ? text : null;
}

function nextTickAt(policy: LiveSessionTickPolicy) {
  if (policy.mode !== "interval" || !policy.interval_seconds) {
    return null;
  }

  return new Date(Date.now() + policy.interval_seconds * 1000).toISOString();
}

function isoAfterSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function globalLiveSessionState() {
  const globalKey = "__hug_live_session_state__";
  const globalStore = globalThis as typeof globalThis & {
    [globalKey]?: SessionState;
  };

  if (!globalStore[globalKey]) {
    globalStore[globalKey] = {
      sessions: []
    };
  }

  return globalStore[globalKey];
}

function globalLiveSessionRunnerState() {
  const globalKey = "__hug_live_session_runner_state__";
  const globalStore = globalThis as typeof globalThis & {
    [globalKey]?: LiveSessionRunnerState;
  };

  if (!globalStore[globalKey]) {
    globalStore[globalKey] = {
      timer: null,
      session_id: null,
      interval_seconds: 30,
      started_at: null,
      last_run_at: null,
      next_run_at: null,
      last_error: null,
      tick_in_progress: false,
      tick_count: 0
    };
  }

  return globalStore[globalKey];
}
