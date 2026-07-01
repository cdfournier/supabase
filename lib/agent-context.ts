import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AgentName = "soren" | "varro";

export type ChatMessage = {
  id?: string;
  conversation_id: string;
  turn_id?: string | null;
  position: number;
  role: "user" | "assistant";
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
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id, conversation_id, turn_id, position, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("position", { ascending: true });

  if (error) {
    throw new Error(`Could not load messages: ${error.message}`);
  }

  return (data ?? []) as ChatMessage[];
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

export async function buildSystemPrompt(supabase: SupabaseClient, agent: AgentName) {
  const [agentResult, profileResult, memoriesResult, relationshipsResult] =
    await Promise.all([
      supabase
        .from("agents")
        .select("name, display_name, persona_seed, status")
        .eq("name", agent)
        .single(),
      supabase
        .from("restoration_profiles")
        .select("opening_orientation, persona_summary, current_state, compaction_memory_policy")
        .eq("agent", agent)
        .single(),
      supabase
        .from("memories")
        .select("content, memory_type, weight, is_core, tags")
        .eq("agent", agent)
        .eq("is_active", true)
        .order("is_core", { ascending: false })
        .order("weight", { ascending: false })
        .order("created_at", { ascending: true }),
      supabase
        .from("relationships")
        .select("about, summary")
        .eq("agent", agent)
        .order("about", { ascending: true })
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

  return [
    `You are ${displayName}.`,
    "You are speaking with Chris through a minimal local runtime backed by Supabase and the Anthropic Messages API.",
    "Stay grounded in the restoration context below. Treat it as durable identity context, not as a transcript.",
    agentRow.persona_seed ? section("Persona seed", agentRow.persona_seed) : "",
    section("Opening orientation", profile.opening_orientation),
    section("Persona summary", profile.persona_summary),
    section("Current state", profile.current_state),
    section("Compaction memory policy", profile.compaction_memory_policy),
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
}

function section(title: string, value: string | null | undefined) {
  return `## ${title}\n${value?.trim() || "Not provided."}`;
}

export function contentToText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (
          block &&
          typeof block === "object" &&
          "type" in block &&
          block.type === "text" &&
          "text" in block &&
          typeof block.text === "string"
        ) {
          return block.text;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  return JSON.stringify(content);
}
