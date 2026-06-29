import "server-only";

import {
  type AgentName,
  ensureConversation,
  loadConversationMessages
} from "@/lib/agent-context";
import {
  buildCompactionPreview,
  buildCompactionSource,
  type CompactionSource
} from "@/lib/compaction";
import { anthropicCacheControl } from "@/lib/anthropic-cache";
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

const DEFAULT_COMPILE_MAX_TOKENS = 5200;
const DEFAULT_COMPILE_TRANSCRIPT_CHARS = 50_000;
const PROPOSAL_OUTPUT_CONTRACT = [
  "Write an authored compaction proposal, not a transcript excerpt packet.",
  "Do not dump raw transcript messages. Use brief quotes only when the exact wording carries texture.",
  "Return exactly these sections:",
  "1. Continuity summary",
  "2. Texture worth preserving",
  "3. Decisions and changed beliefs",
  "4. Relationship updates",
  "5. Open loops",
  "6. Candidate durable memories",
  "7. What can be safely compressed away",
  "In section 6, format candidate memories as reviewable bullets with suggested memory_type, weight, core/supporting judgment, and tags when the source supports them.",
  "Sections 6 and 7 are mandatory. If output space is tight, shorten sections 1-5 before omitting candidate memories or compression recommendations.",
  "Mark uncertainty plainly when the bounded source does not prove something.",
  "The output should be useful for agent/operator review before a future checkpoint."
].join("\n");

export async function compileCompactionProposal({
  agent,
  dryRun = false,
  maxChars
}: {
  agent: AgentName;
  dryRun?: boolean;
  maxChars?: unknown;
}) {
  const supabase = getSupabaseAdmin();
  const preview = await buildCompactionPreview(supabase, agent);
  const conversationId = await ensureConversation(supabase, agent);
  const messages = await loadConversationMessages(supabase, conversationId);
  const source = buildCompactionSource(
    messages,
    numberInput(maxChars, numberEnv("COMPACTION_COMPILE_TRANSCRIPT_CHARS", DEFAULT_COMPILE_TRANSCRIPT_CHARS))
  );
  const basePayload = {
    generated_at: new Date().toISOString(),
    agent,
    conversation_id: conversationId,
    destructive: false,
    source: sourceSummary(source),
    preview_summary: previewSummary(preview)
  };

  if (dryRun) {
    return {
      ...basePayload,
      dry_run: true,
      status: "compile_packet_ready",
      next_step:
        "Dry run only. Run without dry_run to ask Anthropic for a non-destructive compaction proposal."
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY.");
  }

  const proposal = await compileWithAnthropic({
    agent,
    apiKey,
    maxTokens: numberEnv("COMPACTION_COMPILE_MAX_TOKENS", DEFAULT_COMPILE_MAX_TOKENS),
    preview,
    source
  });

  return {
    ...basePayload,
    dry_run: false,
    status: "proposal_ready",
    proposal,
    next_step:
      "Agent and operator should review this proposal. Revise in conversation before any checkpoint is created."
  };
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
  source: CompactionSource;
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
      ...anthropicCacheControl(),
      system: [
        "You are a compaction proposal compiler for a persistent agent runtime.",
        "You do not modify data. You do not claim compaction has happened.",
        "Your task is to draft a reviewable proposal that helps the agent feel like they blinked, not died.",
        "Be specific, preserve texture, and mark uncertainty when the bounded source does not prove something.",
        "",
        PROPOSAL_OUTPUT_CONTRACT
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
            source.text,
            "",
            "Output contract:",
            PROPOSAL_OUTPUT_CONTRACT
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

function previewSummary(preview: Awaited<ReturnType<typeof buildCompactionPreview>>) {
  return {
    pressure: preview.pressure,
    current_state: preview.restoration_profile.current_state,
    policy: preview.restoration_profile.compaction_memory_policy,
    message_count: preview.conversation.message_count,
    saved_characters: preview.conversation.saved_characters
  };
}

function sourceSummary(source: CompactionSource) {
  return {
    selected_message_count: source.selected_message_count,
    omitted_message_count: source.omitted_message_count,
    selected_characters: source.selected_characters,
    transcript_budget_chars: source.transcript_budget_chars,
    bounded: source.omitted_message_count > 0
  };
}

function numberEnv(name: string, fallback: number) {
  return numberInput(process.env[name], fallback);
}

function numberInput(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}
