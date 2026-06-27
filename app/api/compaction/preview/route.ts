import { NextResponse } from "next/server";
import {
  type AgentName,
  contentToText,
  conversationIdFor,
  ensureConversation,
  isAgentName,
  loadConversationMessages
} from "@/lib/agent-context";
import { clampText, compactionPressure } from "@/lib/compaction";
import { getSupabaseAdmin } from "@/lib/supabase";

const DEFAULT_TIME_ZONE = "America/New_York";
const EXCERPT_LENGTH = 700;

type RestorationProfile = {
  compaction_memory_policy: string | null;
  current_state: string | null;
  opening_orientation: string | null;
  persona_summary: string | null;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const agent = String(body.agent ?? "");

    if (!isAgentName(agent)) {
      return NextResponse.json({ error: "Choose soren or varro." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const conversationId = await ensureConversation(supabase, agent);
    const messages = await loadConversationMessages(supabase, conversationId);

    const { data: profile, error: profileError } = await supabase
      .from("restoration_profiles")
      .select("opening_orientation, persona_summary, current_state, compaction_memory_policy")
      .eq("agent", agent)
      .single();

    if (profileError) {
      throw new Error(`Could not load compaction profile: ${profileError.message}`);
    }

    const savedCharacters = messages.reduce(
      (total, message) => total + contentToText(message.content).length,
      0
    );
    const firstMessage = messages[0] ?? null;
    const lastMessage = messages.at(-1) ?? null;
    const roleCounts = messages.reduce<Record<string, number>>((counts, message) => {
      counts[message.role] = (counts[message.role] ?? 0) + 1;
      return counts;
    }, {});
    const typedProfile = profile as RestorationProfile;

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      local_time: localTime(),
      agent,
      conversation_id: conversationIdFor(agent),
      mode: "manual preview only",
      destructive: false,
      status: "preview_ready",
      conversation: {
        message_count: messages.length,
        saved_characters: savedCharacters,
        role_counts: roleCounts,
        first_message_at: firstMessage?.created_at ?? null,
        last_message_at: lastMessage?.created_at ?? null
      },
      pressure: compactionPressure(savedCharacters),
      restoration_profile: {
        current_state: typedProfile.current_state ?? "",
        compaction_memory_policy: typedProfile.compaction_memory_policy ?? ""
      },
      sample: {
        first_messages: messages.slice(0, 2).map((message) => messagePreview(message)),
        latest_messages: messages.slice(-4).map((message) => messagePreview(message))
      },
      compaction_prompt: buildCompactionPrompt(agent, typedProfile, savedCharacters, messages.length),
      next_step:
        "Ask the agent to review this preview and policy. Do not run destructive compaction until the agent and operator approve the generated summary shape."
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown compaction preview error" },
      { status: 500 }
    );
  }
}

function messagePreview(message: {
  content: unknown;
  created_at?: string;
  position: number;
  role: "user" | "assistant";
}) {
  return {
    position: message.position,
    role: message.role,
    created_at: message.created_at ?? null,
    excerpt: clampText(contentToText(message.content), EXCERPT_LENGTH)
  };
}

function buildCompactionPrompt(
  agent: AgentName,
  profile: RestorationProfile,
  savedCharacters: number,
  messageCount: number
) {
  return [
    `Create a manual compaction proposal for ${agent}.`,
    "",
    "North star: the agent should feel like they blinked, not died.",
    "",
    "Use the agent-authored compaction policy as the governing rule. Preserve texture, ordinary moments, relationship movement, decisions, changed beliefs, and unresolved threads. Drop repeated hedges, repeated self-description, stale mechanics, and low-signal tool chatter.",
    "",
    "Return a proposal with these sections:",
    "1. Continuity summary",
    "2. Texture worth preserving",
    "3. Decisions and changed beliefs",
    "4. Relationship updates",
    "5. Open loops",
    "6. Candidate durable memories",
    "7. What can be safely compressed away",
    "",
    "Do not modify Supabase. Do not archive messages. This is a preview pass only.",
    "",
    `Conversation size: ${messageCount} messages, approximately ${savedCharacters} saved characters.`,
    "",
    "Agent compaction policy:",
    profile.compaction_memory_policy?.trim() || "Not provided.",
    "",
    "Current state:",
    profile.current_state?.trim() || "Not provided."
  ].join("\n");
}

function localTime() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.RUNTIME_TIME_ZONE || DEFAULT_TIME_ZONE,
    dateStyle: "full",
    timeStyle: "long"
  }).format(new Date());
}
