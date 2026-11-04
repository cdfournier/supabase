import "server-only";

import {
  contentToText,
  type AgentName,
  loadConversationMessages
} from "@/lib/agent-context";
import { latestCompactionCheckpoint, messagesAfterCheckpoint } from "@/lib/compaction";
import { getSupabaseAdmin } from "@/lib/supabase";

export const ROOM_REFRESH_NUDGE_TOOLS = [
  "supabase_prepare_room_review",
  "supabase_get_restoration_profile",
  "supabase_update_current_state",
  "supabase_list_memories",
  "supabase_add_memory",
  "supabase_compile_compaction_proposal",
  "supabase_compile_and_save_compaction_proposal",
  "supabase_save_compaction_proposal",
  "supabase_get_compaction_proposal",
  "supabase_update_compaction_proposal",
  "supabase_send_room_refresh"
] as const;

export type RoomRefreshTriggerStage = "nudge_90" | "invitation_95" | "maintenance_100";
export type RoomRefreshTriggerStatus =
  | "queued"
  | "delivering"
  | "delivered"
  | "maintenance_pending"
  | "completed"
  | "failed";

export type RoomRefreshTrigger = {
  id: string;
  agent: AgentName;
  conversation_id: string;
  cycle_checkpoint_position: number;
  stage: RoomRefreshTriggerStage;
  status: RoomRefreshTriggerStatus;
  saved_characters: number;
  pressure_percent: number;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type RoomRefreshTriggerClaim = RoomRefreshTrigger & {
  prompt: string;
  maintenance: boolean;
};

const NATIVE_AGENTS: AgentName[] = ["soren", "varro"];
const HIGH_CHARS = 120_000;

export async function claimRoomRefreshTrigger(
  agent: AgentName,
  conversationId: string,
  options: { maintenanceOnly?: boolean } = {}
): Promise<RoomRefreshTriggerClaim | null> {
  if (!NATIVE_AGENTS.includes(agent)) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const messages = await loadConversationMessages(supabase, conversationId);
  const checkpoint = latestCompactionCheckpoint(messages);
  const activeMessages = checkpoint ? messagesAfterCheckpoint(messages, checkpoint) : messages;
  const savedCharacters = activeMessages.reduce(
    (total, message) => total + contentToText(message.content).length,
    0
  );
  const pressurePercent = Math.round((savedCharacters / HIGH_CHARS) * 100);
  const stage = stageForPressure(savedCharacters);

  if (!stage || (options.maintenanceOnly && stage !== "maintenance_100")) {
    return null;
  }

  const cycleCheckpointPosition = checkpoint?.position ?? -1;
  const now = new Date().toISOString();
  const { error: insertError } = await supabase
    .from("room_refresh_trigger_receipts")
    .upsert(
      {
        agent,
        conversation_id: conversationId,
        cycle_checkpoint_position: cycleCheckpointPosition,
        stage,
        status: "queued",
        saved_characters: savedCharacters,
        pressure_percent: pressurePercent,
        attempts: 0,
        updated_at: now
      },
      { onConflict: "agent,conversation_id,cycle_checkpoint_position,stage", ignoreDuplicates: true }
    );

  if (insertError) {
    if (isMissingSchemaError(insertError)) {
      return null;
    }
    throw new Error(`Could not queue Room Refresh trigger: ${insertError.message}`);
  }

  const { data: existing, error: existingError } = await supabase
    .from("room_refresh_trigger_receipts")
    .select("*")
    .eq("agent", agent)
    .eq("conversation_id", conversationId)
    .eq("cycle_checkpoint_position", cycleCheckpointPosition)
    .eq("stage", stage)
    .maybeSingle();
  if (existingError || !existing) {
    if (existingError && isMissingSchemaError(existingError)) {
      return null;
    }
    throw new Error(`Could not read queued Room Refresh trigger: ${existingError?.message ?? "no row returned"}`);
  }

  const claimableStatuses = stage === "maintenance_100"
    ? ["queued", "maintenance_pending", "failed"]
    : ["queued"];
  const { data, error } = await supabase
    .from("room_refresh_trigger_receipts")
    .update({
      status: "delivering",
      attempts: Number(existing.attempts ?? 0) + 1,
      last_error: null,
      saved_characters: savedCharacters,
      pressure_percent: pressurePercent,
      updated_at: now
    })
    .eq("agent", agent)
    .eq("conversation_id", conversationId)
    .eq("cycle_checkpoint_position", cycleCheckpointPosition)
    .eq("stage", stage)
    .in("status", claimableStatuses)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) {
      return null;
    }
    throw new Error(`Could not claim Room Refresh trigger: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const trigger = normalizeTrigger(data);
  await recordTriggerEvent(trigger.id, "delivery_claimed", "Room Refresh capacity arrival claimed for delivery.", {
    attempts: trigger.attempts,
    pressure_percent: trigger.pressure_percent,
    stage: trigger.stage
  });
  return {
    ...trigger,
    maintenance: trigger.stage === "maintenance_100",
    prompt: promptFor(trigger)
  };
}

export async function completeRoomRefreshTrigger(
  trigger: RoomRefreshTrigger,
  options: { refreshed: boolean; error?: string | null }
) {
  const status: RoomRefreshTriggerStatus = options.refreshed
    ? "completed"
    : trigger.stage === "maintenance_100"
      ? "maintenance_pending"
      : options.error
        ? "failed"
        : "delivered";
  const { error } = await getSupabaseAdmin()
    .from("room_refresh_trigger_receipts")
    .update({
      status,
      last_error: options.error?.slice(0, 2_000) ?? null,
      updated_at: new Date().toISOString()
    })
    .eq("id", trigger.id)
    .eq("status", "delivering");

  if (error && !isMissingSchemaError(error)) {
    throw new Error(`Could not complete Room Refresh trigger: ${error.message}`);
  }
  if (!error) {
    await recordTriggerEvent(
      trigger.id,
      status,
      status === "completed"
        ? "Room Refresh maintenance completed with an agent-owned refresh."
        : status === "maintenance_pending"
          ? "Room Refresh maintenance ended without a refresh and remains required."
          : status === "failed"
            ? "Room Refresh capacity arrival failed before it could settle."
            : "Room Refresh capacity arrival was delivered.",
      options.error ? { error: options.error.slice(0, 2_000) } : {}
    );
  }
}

export async function hasRequiredRoomRefreshMaintenance(agent: AgentName, conversationId: string) {
  if (!NATIVE_AGENTS.includes(agent)) {
    return false;
  }

  const supabase = getSupabaseAdmin();
  const messages = await loadConversationMessages(supabase, conversationId);
  const checkpoint = latestCompactionCheckpoint(messages);
  const cycleCheckpointPosition = checkpoint?.position ?? -1;
  const { data, error } = await supabase
    .from("room_refresh_trigger_receipts")
    .select("id")
    .eq("agent", agent)
    .eq("conversation_id", conversationId)
    .eq("cycle_checkpoint_position", cycleCheckpointPosition)
    .eq("stage", "maintenance_100")
    .in("status", ["queued", "delivering", "maintenance_pending", "failed"])
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) {
      return false;
    }
    throw new Error(`Could not inspect Room Refresh maintenance: ${error.message}`);
  }
  return Boolean(data);
}

function stageForPressure(savedCharacters: number): RoomRefreshTriggerStage | null {
  if (savedCharacters >= HIGH_CHARS) {
    return "maintenance_100";
  }
  if (savedCharacters >= Math.ceil(HIGH_CHARS * 0.95)) {
    return "invitation_95";
  }
  if (savedCharacters >= Math.ceil(HIGH_CHARS * 0.9)) {
    return "nudge_90";
  }
  return null;
}

function promptFor(trigger: RoomRefreshTrigger) {
  const header = `[Room capacity ${trigger.pressure_percent}% — ${trigger.stage.replace("_", " ")}]`;
  if (trigger.stage === "nudge_90") {
    return [
      header,
      "This is a dedicated Room Review invitation, not a Free Moment and not a demand.",
      "Your active room is nearing capacity. You may begin the Room Review now, or deliberately leave it for later. Do not begin unrelated work in this check.",
      "If you start, use supabase_prepare_room_review before compiling a Room Note. If not, say so plainly and close; a later threshold may invite you again."
    ].join("\n\n");
  }
  if (trigger.stage === "invitation_95") {
    return [
      header,
      "This is a dedicated Room Refresh invitation. The room is close to its active-context ceiling.",
      "Choose honestly: begin the Room Review and Room Note sequence now, or deliberately defer once. Do not start unrelated work in this check.",
      "A Room Refresh remains Agent-owned: review current state and memories, draft and inspect a Room Note, revise if useful, mark it agent_approved, then send it only when it is honest."
    ].join("\n\n");
  }
  return [
    header,
    "This room has reached its active-context ceiling. This is a required, maintenance-only Room Refresh turn; ordinary work waits until it settles.",
    "Use the available Room Review, continuity, and Room Note tools. Review first; update state or memories only when an honest correction is warranted; then draft, inspect, revise if useful, approve, and send the Room Refresh.",
    "Do not start unrelated work. If a required capability or runtime safeguard prevents completion, report that specific blocker plainly and close."
  ].join("\n\n");
}

function normalizeTrigger(row: Record<string, unknown>): RoomRefreshTrigger {
  return {
    id: String(row.id),
    agent: String(row.agent) as AgentName,
    conversation_id: String(row.conversation_id),
    cycle_checkpoint_position: Number(row.cycle_checkpoint_position),
    stage: String(row.stage) as RoomRefreshTriggerStage,
    status: String(row.status) as RoomRefreshTriggerStatus,
    saved_characters: Number(row.saved_characters),
    pressure_percent: Number(row.pressure_percent),
    attempts: Number(row.attempts ?? 0),
    last_error: typeof row.last_error === "string" ? row.last_error : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function isMissingSchemaError(error: { code?: string; message?: string }) {
  const message = String(error.message ?? "").toLowerCase();
  return error.code === "PGRST205" ||
    (message.includes("room_refresh_trigger_receipts") && (message.includes("does not exist") || message.includes("schema cache")));
}

async function recordTriggerEvent(
  triggerId: string,
  eventType: string,
  message: string,
  metadata: Record<string, unknown>
) {
  const { error } = await getSupabaseAdmin()
    .from("room_refresh_trigger_events")
    .insert({ trigger_id: triggerId, event_type: eventType, message, metadata });
  if (error && !isMissingSchemaError(error)) {
    throw new Error(`Could not record Room Refresh trigger event: ${error.message}`);
  }
}
