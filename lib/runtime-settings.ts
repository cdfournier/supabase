import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  WAKE_CONTROL_TRIGGERS,
  type WakeAgentPolicy,
  type WakeControlPolicy,
  type WakeControlTrigger,
  type WakeMentionPolicy,
  type WakeTriggerPolicy
} from "@/lib/wake-policy";

const FREE_MOMENTS_KEY = "free_moments";
const WORK_PACKET_SIGNALS_KEY = "work_packet_signals";
const WORK_PACKET_SIGNAL_WAKES_KEY = "work_packet_signal_wakes";
const OPERATOR_NOTE_WAKES_KEY = "operator_note_wakes";
const WAKE_CONTROL_POLICY_KEY = "wake_control_policy";

type RuntimeSettingRow = {
  value: Record<string, unknown> | null;
};

export type FreeMomentsSettings = {
  enabled: boolean;
  interval_minutes: number | null;
  schedule_mode: string | null;
};

export type WorkPacketSignalsSettings = {
  enabled: boolean;
  interval_seconds: number | null;
};

export async function readFreeMomentsSettings(): Promise<FreeMomentsSettings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("runtime_settings")
    .select("value")
    .eq("key", FREE_MOMENTS_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read Free Moments setting: ${error.message}`);
  }

  const row = data as RuntimeSettingRow | null;
  const value = row?.value ?? {};
  const intervalMinutes = Number(value.interval_minutes);
  const scheduleMode = typeof value.schedule_mode === "string" ? value.schedule_mode : null;

  return {
    enabled: value.enabled === true,
    interval_minutes: Number.isFinite(intervalMinutes) ? intervalMinutes : null,
    schedule_mode: scheduleMode
  };
}

export async function readFreeMomentsEnabled() {
  return (await readFreeMomentsSettings()).enabled;
}

export async function writeFreeMomentsSettings(settings: {
  enabled: boolean;
  interval_minutes?: number | null;
  schedule_mode?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("runtime_settings")
    .upsert({
      key: FREE_MOMENTS_KEY,
      value: {
        enabled: settings.enabled,
        interval_minutes: settings.interval_minutes ?? null,
        schedule_mode: settings.schedule_mode ?? null
      },
      updated_at: new Date().toISOString()
    });

  if (error) {
    throw new Error(`Could not update Free Moments setting: ${error.message}`);
  }

  return settings;
}

export async function writeFreeMomentsEnabled(enabled: boolean) {
  const existing = await readFreeMomentsSettings().catch(() => ({
    enabled,
    interval_minutes: null,
    schedule_mode: null
  }));
  await writeFreeMomentsSettings({
    enabled,
    interval_minutes: existing.interval_minutes,
    schedule_mode: existing.schedule_mode
  });

  return enabled;
}

export async function readWorkPacketSignalsEnabled() {
  return (await readWorkPacketSignalsSettings()).enabled;
}

export async function writeWorkPacketSignalsEnabled(enabled: boolean) {
  const existing = await readWorkPacketSignalsSettings().catch(() => ({
    enabled,
    interval_seconds: null
  }));
  await writeWorkPacketSignalsSettings({
    enabled,
    interval_seconds: existing.interval_seconds
  });

  return enabled;
}

export async function readWorkPacketSignalsSettings(): Promise<WorkPacketSignalsSettings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("runtime_settings")
    .select("value")
    .eq("key", WORK_PACKET_SIGNALS_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read Work Packet Signals setting: ${error.message}`);
  }

  const row = data as RuntimeSettingRow | null;
  const value = row?.value ?? {};
  const intervalSeconds = Number(value.interval_seconds);

  return {
    enabled: value.enabled === true,
    interval_seconds: Number.isFinite(intervalSeconds) ? intervalSeconds : null
  };
}

export async function writeWorkPacketSignalsSettings(settings: {
  enabled: boolean;
  interval_seconds?: number | null;
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("runtime_settings")
    .upsert({
      key: WORK_PACKET_SIGNALS_KEY,
      value: {
        enabled: settings.enabled,
        interval_seconds: settings.interval_seconds ?? null
      },
      updated_at: new Date().toISOString()
    });

  if (error) {
    throw new Error(`Could not update Work Packet Signals setting: ${error.message}`);
  }

  return settings;
}

export async function readWorkPacketSignalWakesEnabled() {
  return readEnabledSetting(WORK_PACKET_SIGNAL_WAKES_KEY, "Work Packet Signal WAKE");
}

export async function writeWorkPacketSignalWakesEnabled(enabled: boolean) {
  await writeEnabledSetting(WORK_PACKET_SIGNAL_WAKES_KEY, enabled, "Work Packet Signal WAKE");

  return enabled;
}

export async function readOperatorNoteWakesEnabled() {
  return readEnabledSetting(OPERATOR_NOTE_WAKES_KEY, "Operator Note WAKE");
}

export async function writeOperatorNoteWakesEnabled(enabled: boolean) {
  await writeEnabledSetting(OPERATOR_NOTE_WAKES_KEY, enabled, "Operator Note WAKE");

  return enabled;
}

export async function readWakeControlPolicy(): Promise<WakeControlPolicy | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("runtime_settings")
    .select("value")
    .eq("key", WAKE_CONTROL_POLICY_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read WAKE Control Policy setting: ${error.message}`);
  }

  const row = data as RuntimeSettingRow | null;
  return normalizeWakeControlPolicy(row?.value ?? null);
}

export async function writeWakeControlPolicy(policy: unknown) {
  const normalizedPolicy = normalizeWakeControlPolicy(policy);
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("runtime_settings")
    .upsert({
      key: WAKE_CONTROL_POLICY_KEY,
      value: normalizedPolicy,
      updated_at: new Date().toISOString()
    });

  if (error) {
    throw new Error(`Could not update WAKE Control Policy setting: ${error.message}`);
  }

  return normalizedPolicy;
}

async function readEnabledSetting(key: string, label: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("runtime_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read ${label} setting: ${error.message}`);
  }

  const row = data as RuntimeSettingRow | null;
  return row?.value?.enabled === true;
}

async function writeEnabledSetting(key: string, enabled: boolean, label: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("runtime_settings")
    .upsert({
      key,
      value: { enabled },
      updated_at: new Date().toISOString()
    });

  if (error) {
    throw new Error(`Could not update ${label} setting: ${error.message}`);
  }
}

function normalizeWakeControlPolicy(value: unknown): WakeControlPolicy | null {
  if (value === undefined || value === null) {
    return null;
  }

  const record = requireRecord(value, "WAKE Control Policy");
  const all = normalizeWakeAgentPolicy(record.all, "WAKE Control Policy all");
  const agents = normalizeWakeAgents(record.agents);
  const policy: WakeControlPolicy = {};

  if (all) {
    policy.all = all;
  }

  if (agents) {
    policy.agents = agents;
  }

  return policy;
}

function normalizeWakeAgents(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const record = requireRecord(value, "WAKE Control Policy agents");
  const agents: Record<string, WakeAgentPolicy> = {};

  for (const [agentId, agentPolicy] of Object.entries(record)) {
    const normalized = normalizeWakeAgentPolicy(agentPolicy, `WAKE Control Policy agent ${agentId}`);
    if (normalized) {
      agents[agentId] = normalized;
    }
  }

  return Object.keys(agents).length ? agents : undefined;
}

function normalizeWakeAgentPolicy(value: unknown, label: string): WakeAgentPolicy | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const record = requireRecord(value, label);
  const policy: WakeAgentPolicy = {};

  if (record.enabled !== undefined) {
    policy.enabled = requireBoolean(record.enabled, `${label}.enabled`);
  }

  const triggers = normalizeWakeTriggers(record.triggers, label);
  if (triggers) {
    policy.triggers = triggers;
  }

  return policy;
}

function normalizeWakeTriggers(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const record = requireRecord(value, `${label}.triggers`);
  const triggers: Partial<Record<WakeControlTrigger, WakeTriggerPolicy>> = {};

  for (const [trigger, triggerPolicy] of Object.entries(record)) {
    if (!WAKE_CONTROL_TRIGGERS.includes(trigger as WakeControlTrigger)) {
      throw new Error(`Unknown WAKE trigger "${trigger}".`);
    }

    const normalized = normalizeWakeTriggerPolicy(triggerPolicy, `${label}.triggers.${trigger}`);
    if (normalized) {
      triggers[trigger as WakeControlTrigger] = normalized;
    }
  }

  return Object.keys(triggers).length ? triggers : undefined;
}

function normalizeWakeTriggerPolicy(value: unknown, label: string): WakeTriggerPolicy | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const record = requireRecord(value, label);
  const policy: WakeTriggerPolicy = {};

  if (record.enabled !== undefined) {
    policy.enabled = requireBoolean(record.enabled, `${label}.enabled`);
  }

  const mentions = normalizeWakeMentionPolicy(record.mentions, `${label}.mentions`);
  if (mentions) {
    policy.mentions = mentions;
  }

  return policy;
}

function normalizeWakeMentionPolicy(value: unknown, label: string): WakeMentionPolicy | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const record = requireRecord(value, label);
  const policy: WakeMentionPolicy = {};

  if (record.enabled !== undefined) {
    policy.enabled = requireBoolean(record.enabled, `${label}.enabled`);
  }

  const names = optionalStringArray(record.names, `${label}.names`);
  if (names) {
    policy.names = names;
  }

  const aliases = optionalStringArray(record.aliases, `${label}.aliases`);
  if (aliases) {
    policy.aliases = aliases;
  }

  return policy;
}

function optionalStringArray(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((item) => requiredString(item, label)).filter(Boolean);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be true or false.`);
  }

  return value;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} entries must be strings.`);
  }

  return value.trim();
}
