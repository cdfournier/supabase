import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { sendAgentMessage } from "@/lib/chat-runtime";
import { getSupabaseAdmin } from "@/lib/supabase";

const NATIVE_AGENTS: AgentName[] = ["soren", "varro"];
const MAX_NOTE_LENGTH = 600;
const MIN_DELAY_MINUTES = 1;
const MAX_DELAY_MINUTES = 7 * 24 * 60;
const RECENT_LIMIT = 12;

export type QuietTimePolicy = "defer" | "interrupt";
export type WakeAppointmentStatus =
  | "scheduled"
  | "deferred_quiet"
  | "delivering"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";

type WakeAppointmentPolicy = {
  agent: AgentName;
  enabled: boolean;
  allow_quiet_time_interrupt: boolean;
  quiet_start_minute: number | null;
  quiet_end_minute: number | null;
  timezone: string;
  updated_at: string;
};

type WakeAppointment = {
  id: string;
  agent: AgentName;
  note: string;
  quiet_time_policy: QuietTimePolicy;
  due_at: string;
  original_due_at: string;
  status: WakeAppointmentStatus;
  deferred_until: string | null;
  claimed_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type ScheduleRequest = {
  note: string;
  quiet_time_policy: QuietTimePolicy;
  in_minutes?: number;
  due_at?: Date;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let reconciled = false;
let dispatchInProgress = false;

export async function scheduleWakeAppointment(agent: AgentName, input: unknown) {
  assertNativeAgent(agent);
  const request = parseScheduleInput(input);
  const policy = await readWakeAppointmentPolicy(agent);
  assertEnabled(policy);

  if (request.quiet_time_policy === "interrupt" && !policy.allow_quiet_time_interrupt) {
    throw new Error("Quiet-time interruption is not enabled for your wake appointments. Choose defer instead.");
  }

  const now = Date.now();
  const dueAt = request.due_at ?? new Date(now + request.in_minutes! * 60_000);
  const delayMs = dueAt.getTime() - now;
  if (delayMs < MIN_DELAY_MINUTES * 60_000 || delayMs > MAX_DELAY_MINUTES * 60_000) {
    throw new Error(`Wake appointments must be between ${MIN_DELAY_MINUTES} minute and ${MAX_DELAY_MINUTES / 60} hours from now.`);
  }

  const supabase = getSupabaseAdmin();
  const timestamp = new Date().toISOString();
  const { data, error } = await supabase
    .from("agent_wake_appointments")
    .insert({
      agent,
      note: request.note,
      quiet_time_policy: request.quiet_time_policy,
      due_at: dueAt.toISOString(),
      original_due_at: dueAt.toISOString(),
      metadata: { authored_by: `agent:${agent}` },
      updated_at: timestamp
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      const pending = await loadPendingAppointment(agent);
      throw new Error(
        pending
          ? `You already have a pending wake appointment for ${pending.due_at}. Cancel it deliberately before scheduling another.`
          : "You already have a pending wake appointment. Cancel it deliberately before scheduling another."
      );
    }
    throw new Error(`Could not schedule wake appointment: ${error?.message ?? "no row returned"}`);
  }

  const appointment = normalizeAppointment(data);
  await recordAppointmentEvent(appointment.id, "scheduled", "Agent-authored wake appointment scheduled.", {
    due_at: appointment.due_at,
    quiet_time_policy: appointment.quiet_time_policy,
    note: appointment.note
  });
  await armNextWakeAppointment();

  return stringify({
    ok: true,
    appointment: appointmentSummary(appointment),
    receipt: "Your one-time wake appointment is scheduled. It will arrive with normal orientation plus your note."
  });
}

export async function listWakeAppointments(agent: AgentName, input: unknown) {
  assertNativeAgent(agent);
  const includeRecent = !isRecord(input) || input.include_recent !== false;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("agent_wake_appointments")
    .select("*")
    .eq("agent", agent)
    .order("created_at", { ascending: false })
    .limit(includeRecent ? RECENT_LIMIT : 1);

  if (error) {
    throw new Error(`Could not list wake appointments: ${error.message}`);
  }

  return stringify({
    policy: policySummary(await readWakeAppointmentPolicy(agent)),
    appointments: (data ?? []).map(normalizeAppointment).map(appointmentSummary)
  });
}

export async function cancelWakeAppointment(agent: AgentName, input: unknown) {
  assertNativeAgent(agent);
  if (!isRecord(input) || typeof input.appointment_id !== "string" || !input.appointment_id.trim()) {
    throw new Error("wake_appointment_cancel requires the appointment_id returned by wake_appointment_list.");
  }

  const id = input.appointment_id.trim();
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("agent_wake_appointments")
    .update({ status: "cancelled", cancelled_at: now, updated_at: now })
    .eq("id", id)
    .eq("agent", agent)
    .in("status", ["scheduled", "deferred_quiet"])
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not cancel wake appointment: ${error.message}`);
  }
  if (!data) {
    throw new Error("That appointment is not pending, does not belong to you, or is already being delivered.");
  }

  const appointment = normalizeAppointment(data);
  await recordAppointmentEvent(appointment.id, "cancelled", "Agent cancelled their pending wake appointment.");
  await armNextWakeAppointment();

  return stringify({ ok: true, appointment: appointmentSummary(appointment) });
}

export async function statusWithSettings(options: { dispatchDue?: boolean } = {}) {
  await reconcileInterruptedDeliveries();
  if (options.dispatchDue !== false) {
    await dispatchDueWakeAppointments();
  }
  await armNextWakeAppointment();

  const [policies, appointments] = await Promise.all([
    loadPolicies(),
    loadRecentAppointments()
  ]);

  return {
    policies: policies.map(policySummary),
    appointments: appointments.map(appointmentSummary),
    scheduler_armed: Boolean(timer),
    dispatch_in_progress: dispatchInProgress
  };
}

export async function updateWakeAppointmentPolicy(
  agent: AgentName,
  input: {
    enabled: boolean;
    allow_quiet_time_interrupt: boolean;
    quiet_start_minute?: number | null;
    quiet_end_minute?: number | null;
    timezone?: string;
  }
) {
  assertNativeAgent(agent);
  const current = await readWakeAppointmentPolicy(agent);
  const quietStart = input.quiet_start_minute === undefined ? current.quiet_start_minute : input.quiet_start_minute;
  const quietEnd = input.quiet_end_minute === undefined ? current.quiet_end_minute : input.quiet_end_minute;
  validateQuietTime(quietStart, quietEnd);
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("agent_wake_appointment_policies")
    .upsert({
      agent,
      enabled: input.enabled,
      allow_quiet_time_interrupt: input.allow_quiet_time_interrupt,
      quiet_start_minute: quietStart,
      quiet_end_minute: quietEnd,
      timezone: input.timezone?.trim() || current.timezone,
      updated_at: now
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Could not save wake appointment policy: ${error?.message ?? "no row returned"}`);
  }

  return policySummary(normalizePolicy(data));
}

export async function dispatchDueWakeAppointments() {
  if (dispatchInProgress) {
    return;
  }
  dispatchInProgress = true;

  try {
    const due = await loadDueAppointments();
    for (const appointment of due) {
      await dispatchAppointment(appointment);
    }
  } finally {
    dispatchInProgress = false;
    await armNextWakeAppointment();
  }
}

async function dispatchAppointment(appointment: WakeAppointment) {
  const policy = await readWakeAppointmentPolicy(appointment.agent);
  if (!policy.enabled) {
    await failAppointment(appointment, "Wake appointments are disabled by the Operator before delivery.");
    return;
  }

  const now = new Date();
  if (appointment.quiet_time_policy === "defer" && isQuietAt(now, policy)) {
    const nextDue = nextQuietEnd(now, policy);
    const { data, error } = await getSupabaseAdmin()
      .from("agent_wake_appointments")
      .update({
        status: "deferred_quiet",
        due_at: nextDue.toISOString(),
        deferred_until: nextDue.toISOString(),
        updated_at: now.toISOString()
      })
      .eq("id", appointment.id)
      .in("status", ["scheduled", "deferred_quiet"])
      .select("*")
      .maybeSingle();
    if (error) {
      throw new Error(`Could not defer quiet-time appointment: ${error.message}`);
    }
    if (data) {
      await recordAppointmentEvent(appointment.id, "deferred_quiet", "Wake appointment deferred until quiet time ends.", {
        original_due_at: appointment.original_due_at,
        deferred_until: nextDue.toISOString()
      });
    }
    return;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("agent_wake_appointments")
    .update({ status: "delivering", claimed_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", appointment.id)
    .in("status", ["scheduled", "deferred_quiet"])
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(`Could not claim wake appointment: ${error.message}`);
  }
  if (!data) {
    return;
  }

  const claimed = normalizeAppointment(data);
  await recordAppointmentEvent(claimed.id, "delivery_started", "Wake appointment claimed for runtime-native delivery.", {
    quiet_time_policy: claimed.quiet_time_policy,
    delivered_during_quiet_time: isQuietAt(now, policy)
  });

  try {
    await sendAgentMessage(claimed.agent, appointmentPrompt(claimed), { source: "agent_authored_wake" });
    const completedAt = new Date().toISOString();
    const { error: completeError } = await getSupabaseAdmin()
      .from("agent_wake_appointments")
      .update({
        status: "completed",
        delivered_at: completedAt,
        completed_at: completedAt,
        updated_at: completedAt
      })
      .eq("id", claimed.id)
      .eq("status", "delivering");
    if (completeError) {
      throw new Error(`Could not complete wake appointment: ${completeError.message}`);
    }
    await recordAppointmentEvent(claimed.id, "delivered", "Agent-authored wake appointment delivered.");
  } catch (error) {
    await failAppointment(claimed, error instanceof Error ? error.message : "Unknown wake delivery error.");
  }
}

async function failAppointment(appointment: WakeAppointment, error: string) {
  const now = new Date().toISOString();
  const { error: updateError } = await getSupabaseAdmin()
    .from("agent_wake_appointments")
    .update({ status: "failed", error: error.slice(0, 2000), completed_at: now, updated_at: now })
    .eq("id", appointment.id)
    .in("status", ["scheduled", "deferred_quiet", "delivering"]);
  if (updateError) {
    throw new Error(`Could not record wake appointment failure: ${updateError.message}`);
  }
  await recordAppointmentEvent(appointment.id, "failed", "Wake appointment delivery failed.", { error });
}

async function reconcileInterruptedDeliveries() {
  if (reconciled) {
    return;
  }
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("agent_wake_appointments")
    .update({
      status: "interrupted",
      error: "Wake appointment delivery was interrupted by a runtime restart or process loss.",
      completed_at: now,
      updated_at: now
    })
    .eq("status", "delivering")
    .select("id");
  if (error) {
    throw new Error(`Could not reconcile wake appointments: ${error.message}`);
  }
  for (const row of data ?? []) {
    await recordAppointmentEvent(String(row.id), "interrupted", "Wake appointment delivery was interrupted by runtime recovery.");
  }
  reconciled = true;
}

async function armNextWakeAppointment() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const { data, error } = await getSupabaseAdmin()
    .from("agent_wake_appointments")
    .select("due_at")
    .in("status", ["scheduled", "deferred_quiet"])
    .order("due_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not arm wake appointment scheduler: ${error.message}`);
  }
  if (!data?.due_at) {
    return;
  }
  const delay = Math.max(0, Date.parse(String(data.due_at)) - Date.now());
  timer = setTimeout(() => {
    timer = null;
    void dispatchDueWakeAppointments();
  }, Math.min(delay, 2_147_000_000));
}

async function loadDueAppointments() {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_wake_appointments")
    .select("*")
    .in("status", ["scheduled", "deferred_quiet"])
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true });
  if (error) {
    throw new Error(`Could not load due wake appointments: ${error.message}`);
  }
  return (data ?? []).map(normalizeAppointment);
}

async function loadRecentAppointments() {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_wake_appointments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (error) {
    throw new Error(`Could not load wake appointments: ${error.message}`);
  }
  return (data ?? []).map(normalizeAppointment);
}

async function loadPendingAppointment(agent: AgentName) {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_wake_appointments")
    .select("*")
    .eq("agent", agent)
    .in("status", ["scheduled", "deferred_quiet", "delivering"])
    .order("due_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not inspect pending wake appointment: ${error.message}`);
  }
  return data ? normalizeAppointment(data) : null;
}

async function loadPolicies() {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_wake_appointment_policies")
    .select("*")
    .in("agent", NATIVE_AGENTS)
    .order("agent", { ascending: true });
  if (error) {
    throw new Error(`Could not load wake appointment policies: ${error.message}`);
  }
  return (data ?? []).map(normalizePolicy);
}

async function readWakeAppointmentPolicy(agent: AgentName) {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_wake_appointment_policies")
    .select("*")
    .eq("agent", agent)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not read wake appointment policy: ${error.message}`);
  }
  return data ? normalizePolicy(data) : defaultPolicy(agent);
}

async function recordAppointmentEvent(
  appointmentId: string,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {}
) {
  const { error } = await getSupabaseAdmin().from("agent_wake_appointment_events").insert({
    appointment_id: appointmentId,
    event_type: eventType,
    message,
    metadata
  });
  if (error) {
    throw new Error(`Could not record wake appointment event: ${error.message}`);
  }
}

function parseScheduleInput(input: unknown): ScheduleRequest {
  if (!isRecord(input)) {
    throw new Error("wake_appointment_schedule requires an object input.");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!note || note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Wake appointment note is required and must be ${MAX_NOTE_LENGTH} characters or fewer.`);
  }
  if (input.quiet_time_policy !== undefined && input.quiet_time_policy !== "defer" && input.quiet_time_policy !== "interrupt") {
    throw new Error('quiet_time_policy must be "defer" or "interrupt".');
  }
  const quietTimePolicy = input.quiet_time_policy === "interrupt" ? "interrupt" : "defer";
  const inMinutes = Number(input.in_minutes);
  const dueAt = typeof input.due_at === "string" ? new Date(input.due_at) : null;
  const hasDelay = Number.isInteger(inMinutes);
  const hasDueAt = Boolean(dueAt && Number.isFinite(dueAt.getTime()));
  if (hasDelay === hasDueAt) {
    throw new Error("Provide exactly one of in_minutes or due_at.");
  }
  const request: ScheduleRequest = {
    note,
    quiet_time_policy: quietTimePolicy as QuietTimePolicy
  };
  if (hasDelay) {
    request.in_minutes = inMinutes;
  } else {
    request.due_at = dueAt!;
  }
  return request;
}

function appointmentPrompt(appointment: WakeAppointment) {
  return [
    "[Agent-authored wake appointment]",
    "You asked the runtime to wake you at this time. This is an appointment, not a demand and not a Free Moment.",
    "Normal orientation applies. First, notice why you set this; then decide what is actually needed. Passing is allowed if the moment has changed.",
    "## Your note",
    appointment.note
  ].join("\n\n");
}

function isQuietAt(date: Date, policy: WakeAppointmentPolicy) {
  if (policy.quiet_start_minute === null || policy.quiet_end_minute === null) {
    return false;
  }
  const minute = minuteOfDay(date, policy.timezone);
  const start = policy.quiet_start_minute;
  const end = policy.quiet_end_minute;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function nextQuietEnd(now: Date, policy: WakeAppointmentPolicy) {
  for (let offset = 1; offset <= 24 * 60; offset += 1) {
    const candidate = new Date(now.getTime() + offset * 60_000);
    if (!isQuietAt(candidate, policy)) {
      return candidate;
    }
  }
  throw new Error("Quiet time does not contain an available end.");
}

function minuteOfDay(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function validateQuietTime(start: number | null, end: number | null) {
  if ((start === null) !== (end === null)) {
    throw new Error("Quiet time requires both a start and end minute, or neither.");
  }
  if (start === null || end === null) {
    return;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 1439 || end < 0 || end > 1439 || start === end) {
    throw new Error("Quiet-time start and end must be distinct whole minutes from 0 through 1439.");
  }
}

function normalizeAppointment(row: Record<string, unknown>): WakeAppointment {
  return {
    id: String(row.id),
    agent: String(row.agent) as AgentName,
    note: String(row.note),
    quiet_time_policy: row.quiet_time_policy === "interrupt" ? "interrupt" : "defer",
    due_at: String(row.due_at),
    original_due_at: String(row.original_due_at),
    status: String(row.status) as WakeAppointmentStatus,
    deferred_until: stringOrNull(row.deferred_until),
    claimed_at: stringOrNull(row.claimed_at),
    delivered_at: stringOrNull(row.delivered_at),
    cancelled_at: stringOrNull(row.cancelled_at),
    completed_at: stringOrNull(row.completed_at),
    error: stringOrNull(row.error),
    metadata: recordOrEmpty(row.metadata),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function normalizePolicy(row: Record<string, unknown>): WakeAppointmentPolicy {
  return {
    agent: String(row.agent) as AgentName,
    enabled: row.enabled === true,
    allow_quiet_time_interrupt: row.allow_quiet_time_interrupt === true,
    quiet_start_minute: numberOrNull(row.quiet_start_minute),
    quiet_end_minute: numberOrNull(row.quiet_end_minute),
    timezone: typeof row.timezone === "string" && row.timezone ? row.timezone : "America/New_York",
    updated_at: String(row.updated_at ?? new Date(0).toISOString())
  };
}

function defaultPolicy(agent: AgentName): WakeAppointmentPolicy {
  return {
    agent,
    enabled: false,
    allow_quiet_time_interrupt: false,
    quiet_start_minute: null,
    quiet_end_minute: null,
    timezone: "America/New_York",
    updated_at: new Date(0).toISOString()
  };
}

function appointmentSummary(appointment: WakeAppointment) {
  return {
    id: appointment.id,
    agent: appointment.agent,
    due_at: appointment.due_at,
    original_due_at: appointment.original_due_at,
    status: appointment.status,
    quiet_time_policy: appointment.quiet_time_policy,
    note: appointment.note,
    deferred_until: appointment.deferred_until,
    completed_at: appointment.completed_at,
    error: appointment.error
  };
}

function policySummary(policy: WakeAppointmentPolicy) {
  return {
    agent: policy.agent,
    enabled: policy.enabled,
    allow_quiet_time_interrupt: policy.allow_quiet_time_interrupt,
    quiet_start_minute: policy.quiet_start_minute,
    quiet_end_minute: policy.quiet_end_minute,
    timezone: policy.timezone
  };
}

function assertEnabled(policy: WakeAppointmentPolicy) {
  if (!policy.enabled) {
    throw new Error("Agent-authored wake appointments are disabled by the Operator.");
  }
}

function assertNativeAgent(agent: AgentName) {
  if (!NATIVE_AGENTS.includes(agent)) {
    throw new Error("Agent-authored wake appointments are currently available only to soren and varro.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordOrEmpty(value: unknown) {
  return isRecord(value) ? value : {};
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}
