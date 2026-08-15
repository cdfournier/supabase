import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";

const FREE_MOMENTS_KEY = "free_moments";
const WORK_PACKET_SIGNALS_KEY = "work_packet_signals";
const WORK_PACKET_SIGNAL_WAKES_KEY = "work_packet_signal_wakes";

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
