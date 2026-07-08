import { NextResponse } from "next/server";
import {
  type AgentName,
  contentToText,
  conversationIdFor,
  ensureConversation,
  isAgentName,
  loadAgentList,
  loadConversationMessages
} from "@/lib/agent-context";
import {
  compactionPressure,
  isCompactionCheckpointMessage,
  latestCompactionCheckpoint,
  messagesAfterCheckpoint
} from "@/lib/compaction";
import { ANTHROPIC_PROMPT_CACHE_TTL, anthropicPromptCacheEnabled } from "@/lib/anthropic-cache";
import {
  filterToolsForAgent,
  loadAgentCapabilityProfile
} from "@/lib/capability-profile";
import { loadUsageTotals } from "@/lib/model-usage";
import { readFreeMomentsEnabled } from "@/lib/runtime-settings";
import { getSupabaseAdmin } from "@/lib/supabase";
import { toolDefinitions } from "@/lib/tools/registry";

const DEFAULT_TIME_ZONE = "America/New_York";

type ConversationHealthRow = {
  id: string;
  agent: string;
  token_count: number | null;
  compaction_count: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type ArchiveHealthRow = {
  id: string;
  checkpoint_message_id: string | null;
  message_count: number | null;
  source_started_at: string | null;
  source_ended_at: string | null;
  created_at: string | null;
};

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const agents = await loadAgentList(supabase);
    const freeMomentsEnabled = await readFreeMomentsEnabled().catch(() => false);
    const usage = await loadUsageTotals(supabase);
    const agentHealth = [];

    for (const agent of agents) {
      if (!isAgentName(agent.name)) {
        continue;
      }

      agentHealth.push(await buildAgentHealth(supabase, agent.name));
    }

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      local_time: localTime(),
      runtime: {
        time_zone: process.env.RUNTIME_TIME_ZONE || DEFAULT_TIME_ZONE,
        max_tokens: numberEnv("ANTHROPIC_MAX_TOKENS", 1200),
        history_messages: numberEnv("ANTHROPIC_HISTORY_MESSAGES", 6),
        history_message_chars: numberEnv("ANTHROPIC_HISTORY_MESSAGE_CHARS", 3000),
        max_tool_rounds: numberEnv("ANTHROPIC_MAX_TOOL_ROUNDS", 6),
        prompt_cache: anthropicPromptCacheEnabled(),
        prompt_cache_ttl: anthropicPromptCacheEnabled() ? ANTHROPIC_PROMPT_CACHE_TTL : "off",
        free_moments_enabled: freeMomentsEnabled
      },
      env: {
        supabase_url: present("NEXT_PUBLIC_SUPABASE_URL"),
        supabase_service_role_key: present("SUPABASE_SERVICE_ROLE_KEY"),
        anthropic_api_key: present("ANTHROPIC_API_KEY"),
        outpost_token_soren: present("OUTPOST_TOKEN_SOREN"),
        outpost_token_varro: present("OUTPOST_TOKEN_VARRO")
      },
      tools: {
        count: toolDefinitions.length,
        names: toolDefinitions.map((tool) => tool.name)
      },
      compaction: {
        status: "preview enabled; destructive compaction disabled",
        mode: "manual preview first",
        policy: "loaded from restoration_profiles.compaction_memory_policy",
        pressure_basis: "approximate saved conversation character count; not tokenizer-accurate"
      },
      usage,
      agents: agentHealth
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown health error" },
      { status: 500 }
    );
  }
}

async function buildAgentHealth(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  agent: AgentName
) {
  const conversationId = await ensureConversation(supabase, agent);
  const messages = await loadConversationMessages(supabase, conversationId);
  const [
    conversationResult,
    memoryResult,
    relationshipResult,
    proposalResult,
    profileResult,
    archiveResult,
    journalResult,
    toolEventResult,
    sourceAccessResult
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, agent, token_count, compaction_count, created_at, updated_at")
      .eq("id", conversationId)
      .single(),
    supabase
      .from("memories")
      .select("id, is_core, is_active", { count: "exact", head: false })
      .eq("agent", agent),
    supabase
      .from("relationships")
      .select("id", { count: "exact", head: false })
      .eq("agent", agent),
    supabase
      .from("compaction_proposals")
      .select("id", { count: "exact", head: false })
      .eq("agent", agent),
    supabase
      .from("restoration_profiles")
      .select("compaction_memory_policy, updated_at")
      .eq("agent", agent)
      .maybeSingle(),
    supabase
      .from("compaction_archives")
      .select(
        "id, checkpoint_message_id, message_count, source_started_at, source_ended_at, created_at",
        { count: "exact", head: false }
      )
      .eq("agent", agent)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: false })
      .eq("agent", agent),
    supabase
      .from("tool_events")
      .select("id", { count: "exact", head: false })
      .eq("agent", agent),
    supabase
      .from("source_material_access")
      .select("id", { count: "exact", head: false })
      .eq("agent", agent)
  ]);

  if (conversationResult.error) {
    throw new Error(`Could not read conversation health for ${agent}: ${conversationResult.error.message}`);
  }

  if (memoryResult.error) {
    throw new Error(`Could not read memory health for ${agent}: ${memoryResult.error.message}`);
  }

  if (relationshipResult.error) {
    throw new Error(`Could not read relationship health for ${agent}: ${relationshipResult.error.message}`);
  }

  if (profileResult.error) {
    throw new Error(`Could not read restoration profile health for ${agent}: ${profileResult.error.message}`);
  }

  const conversation = conversationResult.data as ConversationHealthRow;
  const checkpoint = latestCompactionCheckpoint(messages);
  const activeMessages = checkpoint ? messagesAfterCheckpoint(messages, checkpoint) : messages;
  const totalSavedCharacters = messages.reduce(
    (total, message) => total + contentToText(message.content).length,
    0
  );
  const savedCharacters = activeMessages.reduce(
    (total, message) => total + contentToText(message.content).length,
    0
  );
  const checkpointCount = messages.filter((message) => isCompactionCheckpointMessage(message)).length;
  const activeMemories = (memoryResult.data ?? []).filter((memory) => memory.is_active !== false);
  const coreMemories = activeMemories.filter((memory) => memory.is_core === true);
  const latestArchive = archiveResult.error
    ? null
    : ((archiveResult.data?.[0] ?? null) as ArchiveHealthRow | null);
  const capabilityProfile = await loadAgentCapabilityProfile(supabase, agent);
  const availableTools = await filterToolsForAgent(supabase, agent, toolDefinitions);
  const usage = await loadUsageTotals(supabase, agent);

  return {
    agent,
    model: modelForAgent(agent),
    conversation_id: conversationIdFor(agent),
    status: "ok",
    conversation: {
      message_count: activeMessages.length,
      total_message_count: messages.length,
      saved_characters: savedCharacters,
      total_saved_characters: totalSavedCharacters,
      stored_token_count: conversation.token_count ?? 0,
      compaction_count: conversation.compaction_count ?? checkpointCount,
      checkpoint_count: checkpointCount,
      latest_checkpoint_position: checkpoint?.position ?? null,
      latest_checkpoint_at: checkpoint?.created_at ?? null,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
      last_message_at: activeMessages.at(-1)?.created_at ?? messages.at(-1)?.created_at ?? null
    },
    archive: {
      table_present: !archiveResult.error,
      archives: archiveResult.error
        ? 0
        : archiveResult.count ?? archiveResult.data?.length ?? 0,
      latest_archive: latestArchive
        ? {
            id: latestArchive.id,
            checkpoint_message_id: latestArchive.checkpoint_message_id,
            message_count: latestArchive.message_count ?? 0,
            source_started_at: latestArchive.source_started_at,
            source_ended_at: latestArchive.source_ended_at,
            created_at: latestArchive.created_at
          }
        : null,
      error: archiveResult.error?.message ?? null
    },
    capability_profile: {
      source: capabilityProfile.source,
      table_present: capabilityProfile.table_present,
      error: capabilityProfile.error,
      surfaces: capabilityProfile.capabilities.map((capability) => ({
        surface: capability.surface,
        access_level: capability.access_level,
        default_bias: capability.default_bias,
        requires_operator_approval: capability.requires_operator_approval,
        notify_operator: capability.notify_operator,
        max_actions_per_moment: capability.max_actions_per_moment,
        quiet_mode: capability.quiet_mode,
        notes: capability.notes
      })),
      available_tool_count: availableTools.length,
      blocked_tool_count: toolDefinitions.length - availableTools.length
    },
    usage,
    memory: {
      rows: memoryResult.count ?? memoryResult.data?.length ?? 0,
      active_rows: activeMemories.length,
      core_rows: coreMemories.length,
      relationships: relationshipResult.count ?? relationshipResult.data?.length ?? 0,
      journal_entries: journalResult.error
        ? 0
        : journalResult.count ?? journalResult.data?.length ?? 0,
      journal_entries_error: journalResult.error?.message ?? null,
      tool_events: toolEventResult.error
        ? 0
        : toolEventResult.count ?? toolEventResult.data?.length ?? 0,
      tool_events_error: toolEventResult.error?.message ?? null,
      source_materials: sourceAccessResult.error
        ? 0
        : sourceAccessResult.count ?? sourceAccessResult.data?.length ?? 0,
      source_materials_error: sourceAccessResult.error?.message ?? null,
      compaction_proposals: proposalResult.error
        ? 0
        : proposalResult.count ?? proposalResult.data?.length ?? 0,
      compaction_proposals_error: proposalResult.error?.message ?? null,
      compaction_policy_configured: Boolean(profileResult.data?.compaction_memory_policy),
      restoration_profile_updated_at: profileResult.data?.updated_at ?? null
    },
    compaction_pressure: compactionPressure(savedCharacters)
  };
}

function modelForAgent(agent: AgentName) {
  if (agent === "soren") {
    return process.env.ANTHROPIC_MODEL_SOREN || process.env.ANTHROPIC_MODEL || "claude-opus-4-6";
  }

  return process.env.ANTHROPIC_MODEL_VARRO || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
}

function localTime() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.RUNTIME_TIME_ZONE || DEFAULT_TIME_ZONE,
    dateStyle: "full",
    timeStyle: "long"
  }).format(new Date());
}

function present(name: string) {
  return Boolean(process.env[name]?.trim());
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) ? value : fallback;
}
