import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentName } from "@/lib/agent-context";

export type ModelMigrationReceipt = {
  id: string;
  agent: AgentName;
  environment: "preview" | "production";
  baseline_provider: string;
  baseline_model: string;
  candidate_provider: string;
  candidate_model: string;
  status: "planned" | "running" | "passed" | "failed" | "rolled_back" | "skipped";
  success_criteria: unknown;
  verification_summary: string | null;
  rollback_posture: string;
  candidate_usage_event_id: string | null;
  rollback_completed_at: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

export type LatestModelMigrationReceipt = {
  table_present: boolean;
  error: string | null;
  receipt: ModelMigrationReceipt | null;
};

/**
 * Read the latest deliberate model-comparison receipt for one Agent. Receipts
 * are Operator-visible records, not runtime controls: a receipt cannot change
 * the selected model or mutate the Agent's continuity records.
 */
export async function loadLatestModelMigrationReceipt(
  supabase: SupabaseClient,
  agent: AgentName
): Promise<LatestModelMigrationReceipt> {
  const { data, error } = await supabase
    .from("model_migration_receipts")
    .select(
      "id, agent, environment, baseline_provider, baseline_model, candidate_provider, candidate_model, status, success_criteria, verification_summary, rollback_posture, candidate_usage_event_id, rollback_completed_at, started_at, completed_at, created_at"
    )
    .eq("agent", agent)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      table_present: !isMissingModelMigrationReceiptTable(error),
      error: error.message,
      receipt: null
    };
  }

  return {
    table_present: true,
    error: null,
    receipt: (data as ModelMigrationReceipt | null) ?? null
  };
}

function isMissingModelMigrationReceiptTable(error: { code?: string | null; message?: string | null }) {
  const message = error.message ?? "";
  return error.code === "PGRST205" || /model_migration_receipts.*does not exist|could not find.*model_migration_receipts/i.test(message);
}
