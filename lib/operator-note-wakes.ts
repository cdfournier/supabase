import "server-only";

import { type AgentName } from "@/lib/agent-context";
import {
  readOperatorNoteWakesEnabled,
  readWakeControlPolicy,
  writeOperatorNoteWakesEnabled
} from "@/lib/runtime-settings";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  decideWakeFromControlPolicy,
  WAKE_RECEIPT_REDISPATCH_BLOCKING_STATUSES,
  wakePriorityForOperatorNote,
  wakeToneForOperatorNote
} from "@/lib/wake-policy";

const EVENT_LIMIT = 40;
const DEFAULT_WAKE_COOLDOWN_SECONDS = 600;
const NATIVE_AGENTS: AgentName[] = ["soren", "varro"];

type OperatorNoteWakeEventType =
  | "started"
  | "stopped"
  | "check_started"
  | "check_completed"
  | "wake_started"
  | "wake_completed"
  | "wake_skipped"
  | "wake_failed"
  | "check_failed";

type OperatorNoteWakeEvent = {
  at: string;
  type: OperatorNoteWakeEventType;
  agent?: AgentName;
  note_id?: string;
  message: string;
};

type OperatorNoteRow = {
  id: string;
  subject: string;
  agent: string;
  status: string;
  agent_status: string;
  last_message_by: string;
  updated_at: string;
};

type OperatorNoteEventRow = {
  id: string;
  note_id: string;
  actor_id: string;
  actor_display_name: string;
  event_type: string;
  content: string;
  created_at: string;
};

type OperatorNoteWakeCandidate = {
  note: OperatorNoteRow;
  event: OperatorNoteEventRow;
};

type WakeReceiptRow = {
  signal_key: string;
  status: string;
};

type ExternalOperatorNoteWakeReceiptStatus = "attempted" | "completed" | "failed";

type ExternalOperatorNoteWakeReceiptRow = {
  id: string;
  signal_key: string;
  note_id: string;
  note_event_id: string;
  participant_id: string;
  delivery_method: string;
  source: string;
  status: string;
  attempted_at: string;
  completed_at: string | null;
  failed_at: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
};

type OperatorNoteWakeState = {
  enabled: boolean;
  nativeWakesInProgress: Set<AgentName>;
  lastNativeWakeAt: Record<AgentName, string | null>;
  lastCheckAt: string | null;
  lastError: string | null;
  recentEvents: OperatorNoteWakeEvent[];
};

const state: OperatorNoteWakeState = {
  enabled: false,
  nativeWakesInProgress: new Set(),
  lastNativeWakeAt: {
    soren: null,
    varro: null
  },
  lastCheckAt: null,
  lastError: null,
  recentEvents: []
};

export function status() {
  return {
    enabled: state.enabled,
    native_wakes_in_progress: [...state.nativeWakesInProgress],
    last_native_wake_at: { ...state.lastNativeWakeAt },
    last_check_at: state.lastCheckAt,
    last_error: state.lastError,
    recent_events: [...state.recentEvents]
  };
}

export async function statusWithSettings(options: { dispatchPending?: boolean } = {}) {
  try {
    const enabled = await readOperatorNoteWakesEnabled();
    state.enabled = enabled;

    if (enabled && options.dispatchPending !== false) {
      await dispatchPendingOperatorNoteWakes();
    }

    return {
      ...status(),
      durable_enabled: enabled,
      durable_error: null
    };
  } catch (error) {
    return {
      ...status(),
      durable_enabled: null,
      durable_error: error instanceof Error ? error.message : "Could not read Operator Note WAKE setting."
    };
  }
}

export async function start() {
  await writeOperatorNoteWakesEnabled(true);
  state.enabled = true;
  state.lastError = null;
  addEvent("started", "Operator Note WAKE enabled.");
  await dispatchPendingOperatorNoteWakes();

  return statusWithSettings({ dispatchPending: false });
}

export async function stop() {
  await writeOperatorNoteWakesEnabled(false);
  state.enabled = false;
  addEvent("stopped", "Operator Note WAKE disabled.");

  return statusWithSettings({ dispatchPending: false });
}

export async function dispatchOperatorNoteWakeForNote(noteId: string) {
  try {
    if (!(await readOperatorNoteWakesEnabled())) {
      state.enabled = false;
      return { ok: true, skipped: true, reason: "Operator Note WAKE is disabled." };
    }

    state.enabled = true;
    const candidate = await loadWakeCandidate(noteId);

    if (!candidate) {
      return { ok: true, skipped: true, reason: "No unread operator-authored note event requires WAKE." };
    }

    await dispatchCandidate(candidate);

    return { ok: true, skipped: false, note_id: noteId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Operator Note WAKE error.";
    state.lastError = message;
    addEvent("wake_failed", message, undefined, noteId);

    return { ok: false, skipped: false, error: message, note_id: noteId };
  }
}

export async function dispatchPendingOperatorNoteWakes() {
  if (!(await readOperatorNoteWakesEnabled())) {
    state.enabled = false;
    return status();
  }

  state.enabled = true;

  try {
    const candidates = await loadPendingWakeCandidates();

    if (candidates.length > 0) {
      addEvent("check_started", "Checking unread Operator Notes for native WAKE.");
    }

    for (const candidate of candidates) {
      await dispatchCandidate(candidate);
    }

    state.lastCheckAt = new Date().toISOString();
    state.lastError = null;
    if (candidates.length > 0) {
      addEvent("check_completed", "Operator Note WAKE check completed.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Operator Note WAKE check error.";
    state.lastError = message;
    addEvent("check_failed", message);
  }

  return status();
}

export async function recordExternalOperatorNoteWakeReceipt(input: unknown) {
  const body = requireRecord(input, "Operator Note WAKE receipt input");
  const participantId = requireJulianExternalParticipant(body.participant_id);
  const deliveryMethod = requireExternalDeliveryMethod(body.delivery_method);
  const receiptStatus = requireExternalReceiptStatus(body.status ?? body.receipt_status);
  const noteId = requiredString(body.id ?? body.note_id, "id", 120);
  const promptExcerpt = optionalString(body.prompt_excerpt, 1000)
    ?? `External Operator Note WAKE receipt for ${participantId}.`;
  const errorMessage = optionalString(body.error, 1000) ?? "";
  const candidate = await loadExternalWakeCandidate(noteId, participantId);
  const signalKey = signalKeyForEvent(candidate.event);
  const existing = await loadExternalReceipt(signalKey, participantId, deliveryMethod);
  const now = new Date().toISOString();

  if (receiptStatus === "attempted") {
    if (existing && WAKE_RECEIPT_REDISPATCH_BLOCKING_STATUSES.includes(existing.status)) {
      return externalReceiptResponse(existing, true, "Receipt already blocks redispatch.");
    }

    const row = existing
      ? await updateExternalReceipt(existing, candidate, receiptStatus, promptExcerpt, externalReceiptMetadata(body, candidate), now)
      : await insertExternalReceipt(participantId, deliveryMethod, candidate, receiptStatus, promptExcerpt, externalReceiptMetadata(body, candidate), now);

    return externalReceiptResponse(row, false);
  }

  if (!existing) {
    throw new Error("External Operator Note WAKE receipt requires an attempted receipt before completion.");
  }

  const row = await updateExternalReceipt(
    existing,
    candidate,
    receiptStatus,
    promptExcerpt,
    externalReceiptMetadata(body, candidate),
    now,
    errorMessage
  );

  return externalReceiptResponse(row, false);
}

async function dispatchCandidate(candidate: OperatorNoteWakeCandidate) {
  const agent = candidate.note.agent as AgentName;
  const participantId = `agent:${agent}`;

  if (!(await shouldWakeCandidateByControlPolicy(agent, candidate))) {
    return;
  }

  if (state.nativeWakesInProgress.has(agent) || isNativeWakeCoolingDown(agent)) {
    return;
  }

  if (await hasDurableReceipt(participantId, signalKeyForEvent(candidate.event))) {
    return;
  }

  await dispatchNativeWake(agent, candidate);
}

async function shouldWakeCandidateByControlPolicy(agent: AgentName, candidate: OperatorNoteWakeCandidate) {
  const policy = await readWakeControlPolicy();
  const decision = decideWakeFromControlPolicy({
    policy,
    agentId: `agent:${agent}`,
    trigger: "operator_note",
    content: [candidate.note.subject, candidate.event.content].filter(Boolean).join("\n")
  });

  if (!decision.shouldWake) {
    addEvent(
      "wake_skipped",
      `WAKE Control Policy skipped Operator Note WAKE for ${agent}: ${decision.reason}.`,
      agent,
      candidate.note.id
    );
  }

  return decision.shouldWake;
}

async function dispatchNativeWake(agent: AgentName, candidate: OperatorNoteWakeCandidate) {
  state.nativeWakesInProgress.add(agent);
  addEvent("wake_started", `WAKE started for ${agent} from Operator Note.`, agent, candidate.note.id);
  const participantId = `agent:${agent}`;
  const prompt = operatorNoteWakePrompt(candidate);
  let attemptedReceiptRecorded = false;

  try {
    await recordWakeReceipt(participantId, candidate, "attempted", prompt);
    attemptedReceiptRecorded = true;

    const { sendAgentMessage } = await import("@/lib/chat-runtime");
    await sendAgentMessage(agent, prompt, {
      source: "operator_note_wake"
    });

    await recordWakeReceipt(participantId, candidate, "completed", prompt);
    state.lastNativeWakeAt[agent] = new Date().toISOString();
    addEvent("wake_completed", `WAKE completed for ${agent}.`, agent, candidate.note.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Operator Note WAKE error.";

    if (attemptedReceiptRecorded) {
      try {
        await recordWakeReceipt(participantId, candidate, "failed", prompt, message);
      } catch (receiptError) {
        const receiptMessage = receiptError instanceof Error
          ? receiptError.message
          : "Unknown Operator Note WAKE receipt error.";
        addEvent("wake_failed", `Could not mark Operator Note WAKE receipt failed for ${agent}: ${receiptMessage}`, agent, candidate.note.id);
      }
    }

    state.lastError = message;
    state.lastNativeWakeAt[agent] = new Date().toISOString();
    addEvent("wake_failed", `WAKE failed for ${agent}: ${message}`, agent, candidate.note.id);
  } finally {
    state.nativeWakesInProgress.delete(agent);
  }
}

async function loadPendingWakeCandidates() {
  const { data, error } = await getSupabaseAdmin()
    .from("operator_notes")
    .select("id, subject, agent, status, agent_status, last_message_by, updated_at")
    .eq("status", "open")
    .eq("agent_status", "unread")
    .in("agent", NATIVE_AGENTS)
    .order("updated_at", { ascending: true })
    .limit(10);

  if (error) {
    throw operatorNoteWakeReceiptSetupError(`Could not read unread Operator Notes: ${error.message}`);
  }

  const candidates = await Promise.all(
    ((data ?? []) as OperatorNoteRow[]).map((note) => loadWakeCandidate(note.id, note))
  );

  return candidates.filter((candidate): candidate is OperatorNoteWakeCandidate => Boolean(candidate));
}

async function loadWakeCandidate(noteId: string, knownNote?: OperatorNoteRow) {
  const note = knownNote ?? await loadNote(noteId);

  if (!note || note.status !== "open" || note.agent_status !== "unread" || !NATIVE_AGENTS.includes(note.agent as AgentName)) {
    return null;
  }

  if (!note.last_message_by.startsWith("operator:")) {
    return null;
  }

  const event = await loadLatestNoteEvent(note.id);

  if (!event || !event.actor_id.startsWith("operator:")) {
    return null;
  }

  return { note, event };
}

async function loadNote(noteId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("operator_notes")
    .select("id, subject, agent, status, agent_status, last_message_by, updated_at")
    .eq("id", noteId)
    .maybeSingle();

  if (error) {
    throw operatorNoteWakeReceiptSetupError(`Could not read Operator Note for WAKE: ${error.message}`);
  }

  return data as OperatorNoteRow | null;
}

async function loadLatestNoteEvent(noteId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("operator_note_events")
    .select("id, note_id, actor_id, actor_display_name, event_type, content, created_at")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw operatorNoteWakeReceiptSetupError(`Could not read Operator Note event for WAKE: ${error.message}`);
  }

  return (data?.[0] ?? null) as OperatorNoteEventRow | null;
}

async function loadLatestOperatorNoteEvent(noteId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("operator_note_events")
    .select("id, note_id, actor_id, actor_display_name, event_type, content, created_at")
    .eq("note_id", noteId)
    .like("actor_id", "operator:%")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw operatorNoteWakeReceiptSetupError(`Could not read Operator Note operator event for WAKE: ${error.message}`);
  }

  return (data?.[0] ?? null) as OperatorNoteEventRow | null;
}

async function loadExternalWakeCandidate(noteId: string, participantId: string) {
  const note = await loadNote(noteId);
  const agent = participantId.replace(/^agent:/, "");

  if (!note || note.status !== "open" || note.agent !== agent) {
    throw new Error("External Operator Note WAKE receipt could not find an open note for that participant.");
  }

  const event = await loadLatestOperatorNoteEvent(note.id);

  if (!event) {
    throw new Error("External Operator Note WAKE receipt requires an operator-authored note event.");
  }

  return { note, event };
}

async function hasDurableReceipt(participantId: string, signalKey: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("operator_note_wake_receipts")
    .select("signal_key, status")
    .eq("participant_id", participantId)
    .eq("delivery_method", "runtime_native")
    .eq("signal_key", signalKey)
    .in("status", WAKE_RECEIPT_REDISPATCH_BLOCKING_STATUSES);

  if (error) {
    throw operatorNoteWakeReceiptSetupError(`Could not read Operator Note WAKE receipts: ${error.message}`);
  }

  return ((data ?? []) as WakeReceiptRow[]).length > 0;
}

async function recordWakeReceipt(
  participantId: string,
  candidate: OperatorNoteWakeCandidate,
  receiptStatus: "attempted" | "completed" | "failed",
  prompt: string,
  errorMessage = ""
) {
  const now = new Date().toISOString();
  const signalKey = signalKeyForEvent(candidate.event);

  if (receiptStatus !== "attempted") {
    const patch = {
      status: receiptStatus,
      completed_at: receiptStatus === "completed" ? now : null,
      failed_at: receiptStatus === "failed" ? now : null,
      error: errorMessage || null
    };
    const { error } = await getSupabaseAdmin()
      .from("operator_note_wake_receipts")
      .update(patch)
      .eq("participant_id", participantId)
      .eq("delivery_method", "runtime_native")
      .eq("signal_key", signalKey);

    if (error) {
      throw operatorNoteWakeReceiptSetupError(`Could not update Operator Note WAKE receipt: ${error.message}`);
    }

    return;
  }

  const { error } = await getSupabaseAdmin()
    .from("operator_note_wake_receipts")
    .upsert({
      signal_key: signalKey,
      note_id: candidate.note.id,
      note_event_id: candidate.event.id,
      participant_id: participantId,
      delivery_method: "runtime_native",
      source: "operator_note_wake",
      wake_priority: wakePriorityForOperatorNote(),
      wake_tone: wakeToneForOperatorNote(),
      status: receiptStatus,
      prompt_excerpt: prompt.slice(0, 1000),
      metadata: {
        note_subject: candidate.note.subject,
        event_type: candidate.event.event_type,
        actor_display_name: candidate.event.actor_display_name
      },
      attempted_at: now,
      completed_at: null,
      failed_at: null,
      error: null
    }, {
      onConflict: "signal_key,participant_id,delivery_method"
    });

  if (error) {
    throw operatorNoteWakeReceiptSetupError(`Could not record Operator Note WAKE receipt: ${error.message}`);
  }
}

async function loadExternalReceipt(signalKey: string, participantId: string, deliveryMethod: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("operator_note_wake_receipts")
    .select(externalReceiptColumns())
    .eq("signal_key", signalKey)
    .eq("participant_id", participantId)
    .eq("delivery_method", deliveryMethod)
    .maybeSingle();

  if (error) {
    throw operatorNoteWakeReceiptSetupError(`Could not read external Operator Note WAKE receipt: ${error.message}`);
  }

  return data as ExternalOperatorNoteWakeReceiptRow | null;
}

async function insertExternalReceipt(
  participantId: string,
  deliveryMethod: string,
  candidate: OperatorNoteWakeCandidate,
  receiptStatus: ExternalOperatorNoteWakeReceiptStatus,
  promptExcerpt: string,
  metadata: Record<string, unknown>,
  now: string
) {
  const { data, error } = await getSupabaseAdmin()
    .from("operator_note_wake_receipts")
    .insert({
      signal_key: signalKeyForEvent(candidate.event),
      note_id: candidate.note.id,
      note_event_id: candidate.event.id,
      participant_id: participantId,
      delivery_method: deliveryMethod,
      source: "operator_note_wake",
      wake_priority: wakePriorityForOperatorNote(),
      wake_tone: wakeToneForOperatorNote(),
      status: receiptStatus,
      prompt_excerpt: promptExcerpt,
      metadata,
      attempted_at: now,
      completed_at: receiptStatus === "completed" ? now : null,
      failed_at: receiptStatus === "failed" ? now : null,
      error: null
    })
    .select(externalReceiptColumns())
    .single();

  if (error) {
    throw operatorNoteWakeReceiptSetupError(`Could not record external Operator Note WAKE receipt: ${error.message}`);
  }

  return data as unknown as ExternalOperatorNoteWakeReceiptRow;
}

async function updateExternalReceipt(
  existing: ExternalOperatorNoteWakeReceiptRow,
  candidate: OperatorNoteWakeCandidate,
  receiptStatus: ExternalOperatorNoteWakeReceiptStatus,
  promptExcerpt: string,
  metadata: Record<string, unknown>,
  now: string,
  errorMessage = ""
) {
  const patch = {
    note_id: candidate.note.id,
    note_event_id: candidate.event.id,
    status: receiptStatus,
    prompt_excerpt: promptExcerpt,
    metadata,
    attempted_at: receiptStatus === "attempted" ? now : existing.attempted_at,
    completed_at: receiptStatus === "completed" ? now : null,
    failed_at: receiptStatus === "failed" ? now : null,
    error: errorMessage || null
  };
  const { data, error } = await getSupabaseAdmin()
    .from("operator_note_wake_receipts")
    .update(patch)
    .eq("id", existing.id)
    .select(externalReceiptColumns())
    .single();

  if (error) {
    throw operatorNoteWakeReceiptSetupError(`Could not update external Operator Note WAKE receipt: ${error.message}`);
  }

  return data as unknown as ExternalOperatorNoteWakeReceiptRow;
}

function operatorNoteWakePrompt(candidate: OperatorNoteWakeCandidate) {
  const subject = candidate.note.subject || "Untitled Operator Note";
  const excerpt = candidate.event.content.slice(0, 800);

  return [
    "[Operator Note arrival - invitation, not assignment]",
    "",
    "A soft Operator Note is waiting for you. This is asynchronous and optional; it is not live chat and not an assignment.",
    "You may read it now, reply if it naturally fits, mark it read after noticing it, defer it for a later Free Moment, or pass quietly.",
    "",
    `Note id: ${candidate.note.id}`,
    `Subject: ${subject}`,
    `Latest trail event from ${candidate.event.actor_display_name}: ${excerpt}`,
    "",
    "Use operator_note_get with the note id before relying on the trail, operator_note_reply if you want to answer, and operator_note_mark_read after you have noticed or handled it."
  ].join("\n");
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

function signalKeyForEvent(event: OperatorNoteEventRow) {
  return `operator_note_event:${event.id}`;
}

function externalReceiptColumns() {
  return [
    "id",
    "signal_key",
    "note_id",
    "note_event_id",
    "participant_id",
    "delivery_method",
    "source",
    "status",
    "attempted_at",
    "completed_at",
    "failed_at",
    "error",
    "metadata"
  ].join(", ");
}

function externalReceiptMetadata(
  body: Record<string, unknown>,
  candidate: OperatorNoteWakeCandidate
) {
  const inputMetadata = optionalRecord(body.metadata) ?? {};
  const restorationConfirmed = optionalBoolean(body.restoration_confirmed)
    ?? optionalBoolean(inputMetadata.restoration_confirmed)
    ?? false;
  const restorationSource = optionalString(body.restoration_source, 240)
    ?? optionalString(inputMetadata.restoration_source, 240)
    ?? "";
  const deliveryFallback = optionalString(body.delivery_fallback, 120)
    ?? optionalString(inputMetadata.delivery_fallback, 120)
    ?? "bridge_polling";

  return {
    ...inputMetadata,
    note_subject: candidate.note.subject,
    event_type: candidate.event.event_type,
    actor_display_name: candidate.event.actor_display_name,
    restoration_confirmed: restorationConfirmed,
    restoration_source: restorationSource,
    delivery_fallback: deliveryFallback,
    receipt_actor: "agent:julian"
  };
}

function externalReceiptResponse(
  receipt: ExternalOperatorNoteWakeReceiptRow,
  skipped: boolean,
  reason?: string
) {
  return {
    ok: true,
    skipped,
    reason: reason ?? null,
    recipient: receipt.participant_id,
    delivery_method: receipt.delivery_method,
    receipt_id: receipt.id,
    restoration_confirmed: optionalBoolean(receipt.metadata.restoration_confirmed) ?? false,
    source: receipt.source,
    source_id: receipt.note_id,
    source_event_id: receipt.note_event_id,
    status: receipt.status,
    message: skipped
      ? reason ?? "External Operator Note WAKE receipt already exists."
      : `External Operator Note WAKE receipt ${receipt.status}.`,
    receipt
  };
}

function requireJulianExternalParticipant(value: unknown) {
  const participantId = requiredString(value, "participant_id", 80);

  if (participantId !== "agent:julian") {
    throw new Error("External Operator Note WAKE receipt V0 only supports agent:julian.");
  }

  return participantId;
}

function requireExternalDeliveryMethod(value: unknown) {
  const deliveryMethod = optionalString(value, 80) ?? "codex_local";

  if (deliveryMethod !== "codex_local") {
    throw new Error("External Operator Note WAKE receipt V0 only supports delivery_method codex_local.");
  }

  return deliveryMethod;
}

function requireExternalReceiptStatus(value: unknown): ExternalOperatorNoteWakeReceiptStatus {
  const status = requiredString(value, "status", 40);

  if (status === "attempted" || status === "completed" || status === "failed") {
    return status;
  }

  throw new Error('External Operator Note WAKE receipt status must be "attempted", "completed", or "failed".');
}

function requiredString(value: unknown, field: string, maxLength: number) {
  const stringValue = String(value ?? "").trim();

  if (!stringValue) {
    throw new Error(`${field} is required.`);
  }

  if (stringValue.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer.`);
  }

  return stringValue;
}

function optionalString(value: unknown, maxLength: number) {
  if (value === undefined || value === null) {
    return null;
  }

  const stringValue = String(value).trim();

  if (!stringValue) {
    return null;
  }

  if (stringValue.length > maxLength) {
    throw new Error(`String value must be ${maxLength} characters or fewer.`);
  }

  return stringValue;
}

function optionalBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function optionalRecord(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("metadata must be an object.");
  }

  return value;
}

function requireRecord(value: unknown, field: string) {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addEvent(type: OperatorNoteWakeEventType, message: string, agent?: AgentName, noteId?: string) {
  state.recentEvents.push({
    at: new Date().toISOString(),
    type,
    agent,
    note_id: noteId,
    message
  });
  state.recentEvents = state.recentEvents.slice(-EVENT_LIMIT);
}

function configuredWakeCooldownSeconds() {
  const value = Number(process.env.OPERATOR_NOTE_WAKE_COOLDOWN_SECONDS);

  return Number.isFinite(value) && value > 0 ? value : DEFAULT_WAKE_COOLDOWN_SECONDS;
}

function operatorNoteWakeReceiptSetupError(message: string) {
  if (message.includes("operator_note_wake_receipts")) {
    return new Error(
      `Operator Note WAKE receipt schema is not installed. Run sql/2026-08-15-operator-note-wake-receipts.sql in Supabase, then restart the runtime. (${message})`
    );
  }

  if (message.includes("operator_notes") || message.includes("operator_note_events")) {
    return new Error(
      `Operator notes schema is not installed. Run sql/2026-08-15-operator-notes.sql in Supabase, then restart the runtime. (${message})`
    );
  }

  return new Error(message);
}
