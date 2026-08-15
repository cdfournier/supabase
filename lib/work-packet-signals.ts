import "server-only";

import {
  readWorkPacketSignalWakesEnabled,
  readWorkPacketSignalsEnabled,
  writeWorkPacketSignalWakesEnabled,
  writeWorkPacketSignalsEnabled
} from "@/lib/runtime-settings";
import { type AgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

const EVENT_LIMIT = 80;
const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 5;
const DEFAULT_WAKE_COOLDOWN_SECONDS = 600;
const NATIVE_AGENTS: AgentName[] = ["soren", "varro"];

type SignalEventType =
  | "started"
  | "stopped"
  | "scheduled"
  | "check_started"
  | "check_completed"
  | "check_blocked"
  | "signal_detected"
  | "wake_started"
  | "wake_completed"
  | "wake_skipped"
  | "wake_failed"
  | "check_failed";

type SignalEvent = {
  id: string;
  source_key?: string;
  at: string;
  type: SignalEventType;
  packet_event_type?: string;
  packet_id?: string;
  packet_title?: string;
  packet_status?: string;
  wake_priority?: string;
  wake_tone?: WakeTone;
  target_ids: string[];
  acknowledged_by: string[];
  woken_by: string[];
  message: string;
};

type PacketEventRow = {
  id: string;
  packet_id: string;
  actor_display_name: string;
  event_type: string;
  response_state: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type PacketRow = {
  id: string;
  title: string;
  status: string;
  owner_agent: string | null;
  conductor: string;
  collaborators: string[];
  wake_priority: string;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

type PacketStatusRow = {
  id: string;
  status: string;
};

type WakeTone =
  | "quiet"
  | "soft"
  | "directed"
  | "high_signal"
  | "recovery"
  | "curiosity"
  | "maintenance";

type WorkPacketSignalsState = {
  running: boolean;
  checkInProgress: boolean;
  intervalSeconds: number;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  lastSeenEventAt: string | null;
  lastError: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  recentEvents: SignalEvent[];
  seenStalePackets: Set<string>;
  autoWakeEnabled: boolean;
  nativeWakesInProgress: Set<AgentName>;
  lastNativeWakeAt: Record<AgentName, string | null>;
};

const state: WorkPacketSignalsState = {
  running: false,
  checkInProgress: false,
  intervalSeconds: configuredDefaultIntervalSeconds(),
  lastCheckAt: null,
  nextCheckAt: null,
  lastSeenEventAt: null,
  lastError: null,
  timer: null,
  recentEvents: [],
  seenStalePackets: new Set(),
  autoWakeEnabled: false,
  nativeWakesInProgress: new Set(),
  lastNativeWakeAt: {
    soren: null,
    varro: null
  }
};

export function status() {
  return {
    running: state.running,
    check_in_progress: state.checkInProgress,
    interval_seconds: state.intervalSeconds,
    last_check_at: state.lastCheckAt,
    next_check_at: state.nextCheckAt,
    last_seen_event_at: state.lastSeenEventAt,
    last_error: state.lastError,
    auto_wake_enabled: state.autoWakeEnabled,
    native_wakes_in_progress: [...state.nativeWakesInProgress],
    last_native_wake_at: { ...state.lastNativeWakeAt },
    recent_events: [...state.recentEvents]
  };
}

export async function statusWithSettings() {
  try {
    await pruneStalePacketSignals();
    const [signalsEnabled, wakesEnabled] = await Promise.all([
      readWorkPacketSignalsEnabled(),
      readWorkPacketSignalWakesEnabled()
    ]);
    state.autoWakeEnabled = wakesEnabled;

    return {
      ...status(),
      durable_enabled: signalsEnabled,
      durable_error: null,
      wake_durable_enabled: wakesEnabled,
      wake_durable_error: null
    };
  } catch (error) {
    return {
      ...status(),
      durable_enabled: null,
      durable_error: error instanceof Error ? error.message : "Could not read Work Packet Signals setting.",
      wake_durable_enabled: null,
      wake_durable_error: error instanceof Error ? error.message : "Could not read Work Packet Signal WAKE setting."
    };
  }
}

export function signalsForParticipant(participantId: string) {
  const signals = state.recentEvents.filter((event) =>
    event.target_ids.includes(participantId)
  );

  return {
    participant_id: participantId,
    running: state.running,
    check_in_progress: state.checkInProgress,
    last_check_at: state.lastCheckAt,
    next_check_at: state.nextCheckAt,
    pending_signals: signals.filter((event) => !event.acknowledged_by.includes(participantId)),
    recent_signals: signals
  };
}

export async function startWakes() {
  await writeWorkPacketSignalWakesEnabled(true);
  state.autoWakeEnabled = true;
  state.lastError = null;
  addEvent("started", "Work Packet Signal WAKE enabled.");

  return {
    ...status(),
    durable_enabled: await readWorkPacketSignalsEnabled(),
    durable_error: null,
    wake_durable_enabled: true,
    wake_durable_error: null
  };
}

export async function stopWakes() {
  await writeWorkPacketSignalWakesEnabled(false);
  state.autoWakeEnabled = false;
  addEvent("stopped", "Work Packet Signal WAKE disabled.");

  return {
    ...status(),
    durable_enabled: await readWorkPacketSignalsEnabled(),
    durable_error: null,
    wake_durable_enabled: false,
    wake_durable_error: null
  };
}

export async function refreshSignalsForParticipant(participantId: string) {
  await tick({ dispatchWakes: false });
  await detectOpenPacketsForParticipant(participantId);
  await pruneStalePacketSignals();

  return signalsForParticipant(participantId);
}

export function acknowledgeSignals(participantId: string, signalId?: string) {
  let acknowledged = 0;

  for (const event of state.recentEvents) {
    if (!event.target_ids.includes(participantId)) {
      continue;
    }

    if (signalId && event.id !== signalId) {
      continue;
    }

    if (!event.acknowledged_by.includes(participantId)) {
      event.acknowledged_by.push(participantId);
      acknowledged += 1;
    }
  }

  return {
    ...signalsForParticipant(participantId),
    acknowledged,
  };
}

export async function start(intervalSeconds?: number) {
  state.intervalSeconds = normalizeIntervalSeconds(intervalSeconds);
  state.lastSeenEventAt = new Date().toISOString();
  state.seenStalePackets.clear();
  await writeWorkPacketSignalsEnabled(true);
  state.running = true;
  state.lastError = null;
  addEvent("started", `Work Packet Signals started at ${state.intervalSeconds} second cadence.`);
  scheduleNextCheck();

  return {
    ...status(),
    durable_enabled: true,
    durable_error: null
  };
}

export async function stop() {
  clearScheduledCheck();
  state.running = false;
  state.nextCheckAt = null;
  addEvent("stopped", "Work Packet Signals stopped.");

  try {
    await writeWorkPacketSignalsEnabled(false);
    state.lastError = null;
    return {
      ...status(),
      durable_enabled: false,
      durable_error: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update Work Packet Signals setting.";
    state.lastError = message;
    addEvent("check_failed", message);
    return {
      ...status(),
      durable_enabled: null,
      durable_error: message
    };
  }
}

export async function tick(options: { scheduled?: boolean; dispatchWakes?: boolean } = {}) {
  if (state.checkInProgress) {
    addEvent("check_blocked", "Work Packet Signals check skipped because another check is in progress.");
    return status();
  }

  clearScheduledCheck();

  if (options.scheduled) {
    try {
      if (!(await readWorkPacketSignalsEnabled())) {
        state.running = false;
        state.nextCheckAt = null;
        addEvent("check_blocked", "Scheduled Work Packet Signals check blocked because runtime setting is disabled.");
        return status();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not verify Work Packet Signals setting.";
      state.running = false;
      state.nextCheckAt = null;
      state.lastError = message;
      addEvent("check_blocked", `Scheduled Work Packet Signals check blocked: ${message}`);
      return status();
    }
  }

  state.checkInProgress = true;
  addEvent("check_started", "Checking work packet signals.");

  try {
    await detectNewPacketEvents();
    await detectStalePackets();
    await detectOpenPacketsForParticipant("agent:soren");
    await detectOpenPacketsForParticipant("agent:varro");
    await pruneStalePacketSignals();
    if (options.dispatchWakes !== false) {
      await wakeNativeAgentsFromPendingSignals();
    }
    state.lastCheckAt = new Date().toISOString();
    state.lastError = null;
    addEvent("check_completed", "Work Packet Signals check completed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Work Packet Signals error.";
    state.lastError = message;
    addEvent("check_failed", message);
  } finally {
    state.checkInProgress = false;

    if (state.running) {
      scheduleNextCheck();
    }
  }

  return status();
}

async function detectNewPacketEvents() {
  const supabase = getSupabaseAdmin();
  const eventTypes = ["created", "packet_ready_for_rollup", "question", "hold", "rollup", "rollup_review"];

  if (!state.lastSeenEventAt) {
    const { data, error } = await supabase
      .from("work_packet_events")
      .select("created_at")
      .in("event_type", eventTypes)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(`Could not initialize work packet signal baseline: ${error.message}`);
    }

    state.lastSeenEventAt = data?.[0]?.created_at ?? null;
    return;
  }

  const { data, error } = await supabase
    .from("work_packet_events")
    .select("id, packet_id, actor_display_name, event_type, response_state, content, metadata, created_at")
    .in("event_type", eventTypes)
    .gt("created_at", state.lastSeenEventAt)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    throw new Error(`Could not read work packet events: ${error.message}`);
  }

  const events = (data ?? []) as PacketEventRow[];

  if (!events.length) {
    return;
  }

  const packetContexts = await loadPacketContexts([...new Set(events.map((event) => event.packet_id))]);

  for (const event of events) {
    const context = packetContexts.get(event.packet_id);
    addEvent(
      "signal_detected",
      signalMessage(event, context),
      event.packet_id,
      context?.title ?? "Unknown packet",
      signalTargets(event, context),
      `event:${event.id}`,
      event.event_type,
      context?.status,
      context?.wake_priority
    );
  }

  state.lastSeenEventAt = events[events.length - 1]?.created_at ?? state.lastSeenEventAt;
}

async function detectStalePackets() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("work_packets")
    .select("id, title, status, owner_agent, conductor, collaborators, wake_priority, metadata, updated_at")
    .not("status", "in", "(merged,closed)")
    .limit(50);

  if (error) {
    throw new Error(`Could not read work packets for stale check: ${error.message}`);
  }

  const now = Date.now();

  for (const packet of (data ?? []) as PacketRow[]) {
    const staleAt = typeof packet.metadata?.stale_at === "string" ? Date.parse(packet.metadata.stale_at) : NaN;

    if (!Number.isFinite(staleAt) || staleAt > now || state.seenStalePackets.has(packet.id)) {
      continue;
    }

    state.seenStalePackets.add(packet.id);
    addEvent(
      "signal_detected",
      `Packet is stale for ${packet.conductor}; wake priority ${packet.wake_priority}.`,
      packet.id,
      packet.title,
      [packet.conductor],
      `stale:${packet.id}`,
      "stale",
      packet.status,
      packet.wake_priority
    );
  }
}

async function detectOpenPacketsForParticipant(participantId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("work_packets")
    .select("id, title, status, owner_agent, conductor, collaborators, wake_priority, metadata, updated_at")
    .not("status", "in", "(merged,closed)")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Could not read work packets for participant signals: ${error.message}`);
  }

  const packets = ((data ?? []) as PacketRow[]).filter((packet) =>
    packet.collaborators.includes(participantId) || packet.owner_agent === participantId
  );

  if (!packets.length) {
    return;
  }

  const packetIds = packets.map((packet) => packet.id);
  const { data: responses, error: responseError } = await supabase
    .from("work_packet_events")
    .select("packet_id, actor_id, response_state")
    .eq("actor_id", participantId)
    .not("response_state", "is", null)
    .in("packet_id", packetIds);

  if (responseError) {
    throw new Error(`Could not read work packet responses for participant signals: ${responseError.message}`);
  }

  const respondedPacketIds = new Set(
    (responses ?? []).map((response) => String(response.packet_id))
  );

  for (const packet of packets) {
    if (respondedPacketIds.has(packet.id)) {
      continue;
    }

    if (hasSignalForParticipantPacket(participantId, packet.id)) {
      continue;
    }

    addEvent(
      "signal_detected",
      `Packet is available for review; conductor ${packet.conductor}.`,
      packet.id,
      packet.title,
      [participantId],
      `participant:${participantId}:packet:${packet.id}:open`,
      "open_packet",
      packet.status,
      packet.wake_priority
    );
  }
}

async function pruneStalePacketSignals() {
  const packetIds = [
    ...new Set(
      state.recentEvents
        .map((event) => event.packet_id)
        .filter((packetId): packetId is string => Boolean(packetId))
    )
  ];

  if (!packetIds.length) {
    return;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("work_packets")
    .select("id, status")
    .in("id", packetIds);

  if (error) {
    throw new Error(`Could not prune stale work packet signals: ${error.message}`);
  }

  const statuses = new Map(
    ((data ?? []) as PacketStatusRow[]).map((packet) => [packet.id, packet.status])
  );

  state.recentEvents = state.recentEvents.filter((event) => {
    if (!event.packet_id || event.type !== "signal_detected") {
      return true;
    }

    const status = statuses.get(event.packet_id);

    if (!status) {
      return false;
    }

    return !(isClosedPacketStatus(status) && isActionablePacketSignal(event));
  });

  state.seenStalePackets = new Set(
    [...state.seenStalePackets].filter((packetId) => {
      const status = statuses.get(packetId);
      return Boolean(status && !isClosedPacketStatus(status));
    })
  );
}

function isActionablePacketSignal(event: SignalEvent) {
  return event.packet_event_type !== "rollup_review";
}

function hasSignalForParticipantPacket(participantId: string, packetId: string) {
  return state.recentEvents.some((event) =>
    event.packet_id === packetId && event.target_ids.includes(participantId)
  );
}

async function wakeNativeAgentsFromPendingSignals() {
  if (!(await readWorkPacketSignalWakesEnabled())) {
    state.autoWakeEnabled = false;
    return;
  }

  state.autoWakeEnabled = true;

  for (const agent of NATIVE_AGENTS) {
    if (state.nativeWakesInProgress.has(agent) || isNativeWakeCoolingDown(agent)) {
      continue;
    }

    const participantId = `agent:${agent}`;
    const signals = state.recentEvents
      .filter((event) => shouldAutoWakeForSignal(event, participantId))
      .slice(0, 5);

    if (!signals.length) {
      continue;
    }

    await dispatchNativeWake(agent, signals);
  }
}

async function dispatchNativeWake(agent: AgentName, signals: SignalEvent[]) {
  state.nativeWakesInProgress.add(agent);
  addEvent("wake_started", `WAKE started for ${agent} from ${signals.length} packet signal(s).`);

  try {
    const { sendAgentMessage } = await import("@/lib/chat-runtime");
    await sendAgentMessage(agent, workPacketSignalWakePrompt(signals), {
      source: "work_packet_signal"
    });

    const participantId = `agent:${agent}`;
    for (const signal of signals) {
      if (!signal.woken_by.includes(participantId)) {
        signal.woken_by.push(participantId);
      }
    }

    state.lastNativeWakeAt[agent] = new Date().toISOString();
    addEvent("wake_completed", `WAKE completed for ${agent}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Work Packet Signal WAKE error.";
    state.lastError = message;
    state.lastNativeWakeAt[agent] = new Date().toISOString();
    addEvent("wake_failed", `WAKE failed for ${agent}: ${message}`);
  } finally {
    state.nativeWakesInProgress.delete(agent);
  }
}

function shouldAutoWakeForSignal(event: SignalEvent, participantId: string) {
  if (event.type !== "signal_detected" || !event.target_ids.includes(participantId)) {
    return false;
  }

  if (!isActionablePacketSignal(event) || event.acknowledged_by.includes(participantId)) {
    return false;
  }

  if (event.woken_by.includes(participantId)) {
    return false;
  }

  const priority = event.wake_priority ?? "digest_only";
  return priority !== "digest_only" && priority !== "silent";
}

function isNativeWakeCoolingDown(agent: AgentName) {
  const lastWakeAt = state.lastNativeWakeAt[agent];

  if (!lastWakeAt) {
    return false;
  }

  const elapsedMs = Date.now() - Date.parse(lastWakeAt);
  const cooldownMs = configuredWakeCooldownSeconds() * 1000;

  return Number.isFinite(elapsedMs) && elapsedMs < cooldownMs;
}

function workPacketSignalWakePrompt(signals: SignalEvent[]) {
  const lines = signals.map((signal) => {
    const title = signal.packet_title || "Untitled packet";
    const id = signal.packet_id ? `packet ${signal.packet_id}` : "packet id unavailable";
    const type = signal.packet_event_type || "signal";
    const status = signal.packet_status || "status unknown";
    const tone = signal.wake_tone || "directed";
    const priority = signal.wake_priority || "digest_only";

    return `- ${title} (${id}) — ${type}, ${status}, tone ${tone}, priority ${priority}: ${signal.message}`;
  });

  return [
    "[A packet signal arrived]",
    "",
    "A Work Packet Signal arrived for you. This is an arrival, not an assignment. You may read it now, defer, pass/no_comment, ask a question, place a hold, save a scratchpad note, or simply acknowledge after noticing.",
    "",
    "Use work_packet_signal_list for exact signal ids, work_packet_get before any packet response, and work_packet_signal_ack after you have noticed or handled a signal.",
    "",
    ...lines
  ].join("\n");
}

async function loadPacketContexts(packetIds: string[]) {
  const contexts = new Map<string, PacketRow>();

  if (!packetIds.length) {
    return contexts;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("work_packets")
    .select("id, title, status, owner_agent, conductor, collaborators, wake_priority, metadata, updated_at")
    .in("id", packetIds);

  if (error) {
    throw new Error(`Could not read work packet titles: ${error.message}`);
  }

  for (const row of (data ?? []) as PacketRow[]) {
    contexts.set(row.id, row);
  }

  return contexts;
}

function signalMessage(event: PacketEventRow, packet?: PacketRow) {
  if (event.event_type === "created") {
    return `Packet is available for review; conductor ${packet?.conductor ?? "unknown"}.`;
  }

  if (event.event_type === "packet_ready_for_rollup") {
    return "Packet is ready for conductor rollup.";
  }

  if (event.event_type === "rollup") {
    return "Conductor rollup is ready for Operator review.";
  }

  if (event.event_type === "rollup_review") {
    const reviewState = String(event.metadata?.review_state ?? "");

    if (reviewState === "approved") {
      return "Operator approved the conductor rollup.";
    }

    if (reviewState === "changes_requested") {
      return `${event.actor_display_name} requested rollup changes: ${event.content || "no details"}`;
    }

    if (reviewState === "hold") {
      return `${event.actor_display_name} placed the rollup on hold: ${event.content || "no details"}`;
    }

    return `${event.actor_display_name} reviewed the conductor rollup.`;
  }

  if (event.event_type === "hold") {
    return `${event.actor_display_name} placed a hold: ${event.content || "no details"}`;
  }

  return `${event.actor_display_name} asked a question: ${event.content || "no details"}`;
}

function signalTargets(event: PacketEventRow, packet?: PacketRow) {
  if (!packet) {
    return [];
  }

  if (event.event_type === "created") {
    if (isClosedPacketStatus(packet.status)) {
      return [];
    }

    return uniqueTargets([
      ...packet.collaborators,
      packet.owner_agent
    ]);
  }

  if (event.event_type === "rollup") {
    return uniqueTargets(["operator:chris"]);
  }

  return uniqueTargets([packet.conductor]);
}

function isClosedPacketStatus(status: string) {
  return status === "merged" || status === "closed";
}

function scheduleNextCheck() {
  clearScheduledCheck();

  if (!state.running || state.checkInProgress) {
    return;
  }

  const delayMs = state.intervalSeconds * 1000;
  const nextCheckAt = new Date(Date.now() + delayMs).toISOString();
  state.nextCheckAt = nextCheckAt;
  state.timer = setTimeout(() => {
    state.timer = null;
    state.nextCheckAt = null;
    void tick({ scheduled: true });
  }, delayMs);
  addEvent("scheduled", `Next Work Packet Signals check scheduled for ${nextCheckAt}.`);
}

function clearScheduledCheck() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  state.nextCheckAt = null;
}

function addEvent(
  type: SignalEventType,
  message: string,
  packetId?: string,
  packetTitle?: string,
  targetIds: string[] = [],
  sourceKey?: string,
  packetEventType?: string,
  packetStatus?: string,
  wakePriority?: string
) {
  if (sourceKey && state.recentEvents.some((event) => event.source_key === sourceKey)) {
    return;
  }

  if (type === "signal_detected" && targetIds.length === 0) {
    return;
  }

  state.recentEvents.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    source_key: sourceKey,
    at: new Date().toISOString(),
    type,
    packet_event_type: packetEventType,
    packet_id: packetId,
    packet_title: packetTitle,
    packet_status: packetStatus,
    wake_priority: wakePriority,
    wake_tone: wakeTone(packetEventType, wakePriority),
    target_ids: targetIds,
    acknowledged_by: [],
    woken_by: [],
    message
  });
  state.recentEvents = state.recentEvents.slice(-EVENT_LIMIT);
}

function wakeTone(packetEventType?: string, wakePriority?: string): WakeTone {
  if (wakePriority === "silent") {
    return "quiet";
  }

  if (wakePriority === "loud") {
    return "high_signal";
  }

  if (packetEventType === "hold" || packetEventType === "question" || packetEventType === "stale") {
    return "high_signal";
  }

  if (wakePriority === "quiet") {
    return "soft";
  }

  if (packetEventType === "rollup_review") {
    return "quiet";
  }

  if (packetEventType === "open_packet" || packetEventType === "created" || packetEventType === "packet_ready_for_rollup") {
    return "directed";
  }

  return "directed";
}

function uniqueTargets(targets: Array<string | null | undefined>) {
  return [...new Set(targets.filter((target): target is string => Boolean(target)))];
}

function normalizeIntervalSeconds(value?: number) {
  const requested = Number(value);
  const interval = Number.isFinite(requested) && requested > 0
    ? requested
    : configuredDefaultIntervalSeconds();
  const minimum = configuredMinIntervalSeconds();

  return Math.max(minimum, interval);
}

function configuredDefaultIntervalSeconds() {
  return positiveNumberEnv("WORK_PACKET_SIGNALS_DEFAULT_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS);
}

function configuredMinIntervalSeconds() {
  return positiveNumberEnv("WORK_PACKET_SIGNALS_MIN_INTERVAL_SECONDS", MIN_INTERVAL_SECONDS);
}

function configuredWakeCooldownSeconds() {
  return positiveNumberEnv("WORK_PACKET_SIGNAL_WAKE_COOLDOWN_SECONDS", DEFAULT_WAKE_COOLDOWN_SECONDS);
}

function positiveNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}
