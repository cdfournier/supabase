import "server-only";

import { type AgentName } from "@/lib/agent-context";
import {
  readOperatorNoteWakesEnabled,
  writeOperatorNoteWakesEnabled
} from "@/lib/runtime-settings";
import { getSupabaseAdmin } from "@/lib/supabase";
import { WAKE_RECEIPT_REDISPATCH_BLOCKING_STATUSES } from "@/lib/wake-policy";

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

async function dispatchCandidate(candidate: OperatorNoteWakeCandidate) {
  const agent = candidate.note.agent as AgentName;
  const participantId = `agent:${agent}`;

  if (state.nativeWakesInProgress.has(agent) || isNativeWakeCoolingDown(agent)) {
    return;
  }

  if (await hasDurableReceipt(participantId, signalKeyForEvent(candidate.event))) {
    return;
  }

  await dispatchNativeWake(agent, candidate);
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
      wake_priority: "quiet",
      wake_tone: "soft",
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
