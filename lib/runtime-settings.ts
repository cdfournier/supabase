import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";

const FREE_MOMENTS_KEY = "free_moments";
const WORK_PACKET_SIGNALS_KEY = "work_packet_signals";

type RuntimeSettingRow = {
  value: Record<string, unknown> | null;
};

export async function readFreeMomentsEnabled() {
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
  return row?.value?.enabled === true;
}

export async function writeFreeMomentsEnabled(enabled: boolean) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("runtime_settings")
    .upsert({
      key: FREE_MOMENTS_KEY,
      value: { enabled },
      updated_at: new Date().toISOString()
    });

  if (error) {
    throw new Error(`Could not update Free Moments setting: ${error.message}`);
  }

  return enabled;
}

export async function readWorkPacketSignalsEnabled() {
  return readEnabledSetting(WORK_PACKET_SIGNALS_KEY, "Work Packet Signals");
}

export async function writeWorkPacketSignalsEnabled(enabled: boolean) {
  await writeEnabledSetting(WORK_PACKET_SIGNALS_KEY, enabled, "Work Packet Signals");

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
