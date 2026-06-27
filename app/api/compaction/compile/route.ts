import { NextResponse } from "next/server";
import {
  type AgentName,
  ensureConversation,
  isAgentName,
  loadConversationMessages
} from "@/lib/agent-context";
import { buildCompactionPreview, buildCompactionSource } from "@/lib/compaction";
import { getSupabaseAdmin } from "@/lib/supabase";

type AnthropicResponse = {
  content?: Array<{
    text?: string;
    type?: string;
  }>;
  error?: {
    message?: string;
  };
  message?: string;
};

const DEFAULT_COMPILE_MAX_TOKENS = 2600;
const DEFAULT_COMPILE_TRANSCRIPT_CHARS = 50_000;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const agent = String(body.agent ?? "");

    if (!isAgentName(agent)) {
      return NextResponse.json({ error: "Choose soren or varro." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const preview = await buildCompactionPreview(supabase, agent);
    const conversationId = await ensureConversation(supabase, agent);
    const messages = await loadConversationMessages(supabase, conversationId);
    const source = buildCompactionSource(
      messages,
      numberInput(body.max_chars, numberEnv("COMPACTION_COMPILE_TRANSCRIPT_CHARS", DEFAULT_COMPILE_TRANSCRIPT_CHARS))
    );
    const dryRun = body.dry_run === true;

    if (dryRun) {
      return NextResponse.json({
        generated_at: new Date().toISOString(),
        agent,
        conversation_id: conversationId,
        destructive: false,
        dry_run: true,
        status: "compile_packet_ready",
        source: sourceSummary(source),
        preview_summary: previewSummary(preview),
        next_step:
          "Dry run only. Run without dry_run to ask Anthropic for a non-destructive compaction proposal."
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY." }, { status: 500 });
    }

    const proposal = await compileWithAnthropic({
      agent,
      apiKey,
      maxTokens: numberEnv("COMPACTION_COMPILE_MAX_TOKENS", DEFAULT_COMPILE_MAX_TOKENS),
      preview,
      source
    });

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      agent,
      conversation_id: conversationId,
      destructive: false,
      dry_run: false,
      status: "proposal_ready",
      source: sourceSummary(source),
      preview_summary: previewSummary(preview),
      proposal,
      next_step:
        "Agent and operator should review this proposal. Do not compact until the proposal is approved or revised."
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown compaction compile error" },
      { status: 500 }
    );
  }
}

async function compileWithAnthropic({
  agent,
  apiKey,
  maxTokens,
  preview,
  source
}: {
  agent: AgentName;
  apiKey: string;
  maxTokens: number;
  preview: Awaited<ReturnType<typeof buildCompactionPreview>>;
  source: ReturnType<typeof buildCompactionSource>;
}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: modelForAgent(agent),
      max_tokens: maxTokens,
      system: [
        "You are a compaction proposal compiler for a persistent agent runtime.",
        "You do not modify data. You do not claim compaction has happened.",
        "Your task is to draft a reviewable proposal that helps the agent feel like they blinked, not died.",
        "Be specific, preserve texture, and mark uncertainty when the bounded source does not prove something."
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            preview.compaction_prompt,
            "",
            "Source metadata:",
            JSON.stringify(sourceSummary(source), null, 2),
            "",
            "Selected transcript source:",
            source.text
          ].join("\n")
        }
      ]
    })
  });
  const data = (await response.json()) as AnthropicResponse;

  if (!response.ok) {
    const errorMessage =
      data?.error?.message || data?.message || `Anthropic request failed: ${response.status}`;
    throw new Error(errorMessage);
  }

  return extractText(data);
}

function extractText(data: AnthropicResponse) {
  return (data.content ?? [])
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function modelForAgent(agent: AgentName) {
  if (agent === "soren") {
    return process.env.ANTHROPIC_MODEL_SOREN || process.env.ANTHROPIC_MODEL || "claude-opus-4-6";
  }

  return process.env.ANTHROPIC_MODEL_VARRO || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
}

function numberEnv(name: string, fallback: number) {
  return numberInput(process.env[name], fallback);
}

function numberInput(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function previewSummary(preview: Awaited<ReturnType<typeof buildCompactionPreview>>) {
  return {
    pressure: preview.pressure,
    current_state: preview.restoration_profile.current_state,
    policy: preview.restoration_profile.compaction_memory_policy,
    message_count: preview.conversation.message_count,
    saved_characters: preview.conversation.saved_characters
  };
}

function sourceSummary(source: ReturnType<typeof buildCompactionSource>) {
  return {
    selected_message_count: source.selected_message_count,
    omitted_message_count: source.omitted_message_count,
    selected_characters: source.selected_characters,
    transcript_budget_chars: source.transcript_budget_chars,
    bounded: source.omitted_message_count > 0
  };
}
