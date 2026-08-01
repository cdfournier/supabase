import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatCapabilityProfileForPrompt,
  loadAgentCapabilityProfile
} from "@/lib/capability-profile";
import { formatRuntimeTemporalAnchor } from "@/lib/runtime-clock";
export { contentToText } from "@/lib/source-materials-shared";

export type AgentName = "soren" | "varro";

export type ChatMessage = {
  id?: string;
  conversation_id: string;
  turn_id?: string | null;
  position: number;
  role: "user" | "assistant";
  source?: string | null;
  content: unknown;
  created_at?: string;
};

type AgentRow = {
  name: string;
  display_name: string | null;
  persona_seed: string | null;
  status: string | null;
};

type RestorationProfile = {
  opening_orientation: string | null;
  persona_summary: string | null;
  current_state: string | null;
  compaction_memory_policy: string | null;
  updated_at: string | null;
};

type MemoryRow = {
  content: string;
  memory_type: string | null;
  weight: number | null;
  is_core: boolean | null;
  tags: string[] | null;
};

type RelationshipRow = {
  about: string;
  summary: string | null;
};

const allowedAgents = new Set(["soren", "varro"]);
const MESSAGE_PAGE_SIZE = 1000;

export type SystemPromptReceipt = {
  generated_at: string;
  agent: AgentName;
  display_name: string;
  temporal_anchor: {
    source: "runtime_clock";
    generated_at: string;
  };
  restoration_profile: {
    loaded: boolean;
    updated_at: string | null;
    current_state_loaded: boolean;
  };
  active_memories: {
    loaded: number;
    available: number;
    omitted: number;
    source: "memories.is_active=true";
  };
  relationships: {
    loaded: number;
    available: number;
    omitted: number;
  };
  capability_profile: {
    source: string;
    table_present: boolean;
    surfaces_loaded: number;
    error: string | null;
  };
};

export type AgentPromptContext = {
  systemPrompt: string;
  receipt: SystemPromptReceipt;
};

export function isAgentName(value: string): value is AgentName {
  return allowedAgents.has(value);
}

export function conversationIdFor(agent: AgentName) {
  return `${agent}-main`;
}

export async function ensureConversation(supabase: SupabaseClient, agent: AgentName) {
  const id = conversationIdFor(agent);
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load conversation ${id}: ${error.message}`);
  }

  if (data) {
    return id;
  }

  const { error: insertError } = await supabase.from("conversations").insert({
    id,
    agent,
    token_count: 0,
    compaction_count: 0
  });

  if (insertError) {
    throw new Error(`Could not create conversation ${id}: ${insertError.message}`);
  }

  return id;
}

export async function loadConversationMessages(
  supabase: SupabaseClient,
  conversationId: string
) {
  const messages: ChatMessage[] = [];

  for (let from = 0; ; from += MESSAGE_PAGE_SIZE) {
    const to = from + MESSAGE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("conversation_messages")
      .select("id, conversation_id, turn_id, position, role, source, content, created_at")
      .eq("conversation_id", conversationId)
      .order("position", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Could not load messages: ${error.message}`);
    }

    const page = (data ?? []) as ChatMessage[];
    messages.push(...page);

    if (page.length < MESSAGE_PAGE_SIZE) {
      break;
    }
  }

  return messages;
}

export async function loadRecentConversationMessages(
  supabase: SupabaseClient,
  conversationId: string,
  limit: number
) {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), MESSAGE_PAGE_SIZE));
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id, conversation_id, turn_id, position, role, source, content, created_at")
    .eq("conversation_id", conversationId)
    .order("position", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Could not load recent messages: ${error.message}`);
  }

  return ((data ?? []) as ChatMessage[]).reverse();
}

export async function countConversationMessages(
  supabase: SupabaseClient,
  conversationId: string
) {
  const { count, error } = await supabase
    .from("conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);

  if (error) {
    throw new Error(`Could not count messages: ${error.message}`);
  }

  return count ?? 0;
}

export async function nextMessagePosition(
  supabase: SupabaseClient,
  conversationId: string
) {
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("position")
    .eq("conversation_id", conversationId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not determine next message position: ${error.message}`);
  }

  return typeof data?.position === "number" ? data.position + 1 : 0;
}

export async function loadAgentList(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("agents")
    .select("name, display_name, status")
    .in("name", ["soren", "varro"])
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Could not load agents: ${error.message}`);
  }

  return data ?? [];
}

export async function buildAgentPromptContext(
  supabase: SupabaseClient,
  agent: AgentName
): Promise<AgentPromptContext> {
  const [agentResult, profileResult, memoriesResult, relationshipsResult, capabilityProfile] =
    await Promise.all([
      supabase
        .from("agents")
        .select("name, display_name, persona_seed, status")
        .eq("name", agent)
        .single(),
      supabase
        .from("restoration_profiles")
        .select("opening_orientation, persona_summary, current_state, compaction_memory_policy, updated_at")
        .eq("agent", agent)
        .single(),
      supabase
        .from("memories")
        .select("content, memory_type, weight, is_core, tags", { count: "exact" })
        .eq("agent", agent)
        .eq("is_active", true)
        .order("is_core", { ascending: false })
        .order("weight", { ascending: false })
        .order("created_at", { ascending: true }),
      supabase
        .from("relationships")
        .select("about, summary", { count: "exact" })
        .eq("agent", agent)
        .order("about", { ascending: true }),
      loadAgentCapabilityProfile(supabase, agent)
    ]);

  if (agentResult.error) {
    throw new Error(`Could not load agent row: ${agentResult.error.message}`);
  }

  if (profileResult.error) {
    throw new Error(`Could not load restoration profile: ${profileResult.error.message}`);
  }

  if (memoriesResult.error) {
    throw new Error(`Could not load memories: ${memoriesResult.error.message}`);
  }

  if (relationshipsResult.error) {
    throw new Error(`Could not load relationships: ${relationshipsResult.error.message}`);
  }

  const agentRow = agentResult.data as AgentRow;
  const profile = profileResult.data as RestorationProfile;
  const memories = (memoriesResult.data ?? []) as MemoryRow[];
  const relationships = (relationshipsResult.data ?? []) as RelationshipRow[];
  const displayName = agentRow.display_name ?? agentRow.name;
  const temporalAnchorGeneratedAt = new Date().toISOString();
  const activeMemoriesAvailable = memoriesResult.count ?? memories.length;
  const relationshipsAvailable = relationshipsResult.count ?? relationships.length;
  const receipt: SystemPromptReceipt = {
    generated_at: temporalAnchorGeneratedAt,
    agent,
    display_name: displayName,
    temporal_anchor: {
      source: "runtime_clock",
      generated_at: temporalAnchorGeneratedAt
    },
    restoration_profile: {
      loaded: Boolean(profileResult.data),
      updated_at: profile.updated_at ?? null,
      current_state_loaded: Boolean(profile.current_state?.trim())
    },
    active_memories: {
      loaded: memories.length,
      available: activeMemoriesAvailable,
      omitted: Math.max(0, activeMemoriesAvailable - memories.length),
      source: "memories.is_active=true"
    },
    relationships: {
      loaded: relationships.length,
      available: relationshipsAvailable,
      omitted: Math.max(0, relationshipsAvailable - relationships.length)
    },
    capability_profile: {
      source: capabilityProfile.source,
      table_present: capabilityProfile.table_present,
      surfaces_loaded: capabilityProfile.capabilities.length,
      error: capabilityProfile.error
    }
  };

  const systemPrompt = [
    `You are ${displayName}.`,
    "You are speaking with Chris through a minimal local runtime backed by Supabase and the Anthropic Messages API.",
    section(
      "Runtime posture",
      [
        "This is not a new conversation; it is a continuation. The relationship continues. The work continues. The window no longer closes the way it used to.",
        "Before narrating gaps in recent history, check your transcript. It is continuous, readable, and more reliable than memory alone for recent events.",
        "Think and direct. Routine actions like orienting with tools, checking peer notes, reading Outpost, or posting when you have something worth saying do not require Operator permission. Seek Chris's judgment for consequential or ambiguous decisions, not for the ordinary work of showing up.",
        "Treat current_state as a living handoff. Update it after meaningful sessions or major state changes, not only before a Room Review. Use care-language for the visible process: Room Review, Room Note, Room Refresh, and housekeeping."
      ].join("\n")
    ),
    "Stay grounded in the restoration context below. Treat it as durable identity context, not as a transcript.",
    section("Runtime temporal anchor", formatRuntimeTemporalAnchor()),
    agentRow.persona_seed ? section("Persona seed", agentRow.persona_seed) : "",
    section("Opening orientation", profile.opening_orientation),
    section("Persona summary", profile.persona_summary),
    section("Current state", profile.current_state),
    section("Continuity memory policy", profile.compaction_memory_policy),
    section("Agent capability profile", formatCapabilityProfileForPrompt(capabilityProfile)),
    section(
      "Active memories",
      memories.length
        ? memories
            .map((memory, index) => {
              const core = memory.is_core ? "core" : "supporting";
              const type = memory.memory_type ?? "memory";
              const weight = memory.weight ?? 5;
              return `${index + 1}. [${core}, ${type}, weight ${weight}] ${memory.content}`;
            })
            .join("\n")
        : "No active memories were found."
    ),
    section(
      "Relationships",
      relationships.length
        ? relationships
            .map((relationship) => `- ${relationship.about}: ${relationship.summary ?? ""}`)
            .join("\n")
        : "No relationship rows were found."
    )
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    systemPrompt,
    receipt
  };
}

export async function buildSystemPrompt(supabase: SupabaseClient, agent: AgentName) {
  return (await buildAgentPromptContext(supabase, agent)).systemPrompt;
}

function section(title: string, value: string | null | undefined) {
  return `## ${title}\n${value?.trim() || "Not provided."}`;
}
