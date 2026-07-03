import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";

const FREE_MOMENTS_KEY = "free_moments";

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
