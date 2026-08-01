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
import { recordModelUsage } from "@/lib/model-usage";
import { getSupabaseAdmin } from "@/lib/supabase";

type AnthropicResponse = {
  id?: string;
  model?: string;
  content?: Array<{
    text?: string;
    type?: string;
  }>;
  stop_reason?: string;
  usage?: unknown;
  error?: {
    message?: string;
  };
  message?: string;
};

const DEFAULT_COMPILE_MAX_TOKENS = 9000;
const DEFAULT_COMPILE_TRANSCRIPT_CHARS = 50_000;
const PROPOSAL_OUTPUT_CONTRACT = [
  "Write an authored Room Note, not a transcript excerpt packet.",
  "Use care-language in the authored output: Room Review, Room Note, Room Refresh, and housekeeping.",
  "Begin exactly with the first required heading. Do not add a separate title above it.",
  "Internal records may still use legacy implementation vocabulary in metadata, routes, or source names; do not expose those as the lived surface.",
  "Do not dump raw transcript messages. Use brief quotes only when the exact wording carries texture.",
  "Return exactly this Markdown skeleton with all seven headings:",
  "## 1. Continuity summary",
  "## 2. Texture worth preserving",
  "## 3. Decisions and changed beliefs",
  "## 4. Relationship updates",
  "## 5. Open loops",
  "## 6. Candidate durable memories",
  "## 7. What can be safely compressed away",
  "Write every heading before you finish. Do not stop after section 5.",
  "Keep sections 1-5 concise: at most 5 bullets per section and at most 35 words per bullet.",
  "In section 6, provide at most 10 reviewable bullets with suggested memory_type, weight, core/supporting judgment, and tags when the source supports them.",
  "In section 7, provide at most 8 bullets.",
  "Sections 6 and 7 are mandatory. If output space is tight, make sections 1-5 shorter; never omit candidate memories or compression recommendations.",
  "Mark uncertainty plainly when the bounded source does not prove something.",
  "The output should be useful for Agent/Operator review before a future Room Refresh."
].join("\n");

export async function compileCompactionProposal({
  agent,
  dryRun = false,
  maxChars,
  maxTokens,
  requestSource = "compaction_compile"
}: {
  agent: AgentName;
  dryRun?: boolean;
  maxChars?: unknown;
  maxTokens?: unknown;
  requestSource?: string;
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
        "Dry run only. Run without dry_run to ask Anthropic for a non-destructive Room Note."
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY.");
  }

  const proposal = await compileWithAnthropic({
    agent,
    apiKey,
    conversationId,
    requestSource,
    maxTokens: numberInput(
      maxTokens,
      numberEnv("COMPACTION_COMPILE_MAX_TOKENS", DEFAULT_COMPILE_MAX_TOKENS)
    ),
    preview,
    source
  });

  return {
    ...basePayload,
    dry_run: false,
    status: "proposal_ready",
    proposal,
    next_step:
      "Agent and Operator should review this Room Note. Revise in conversation before housekeeping is sent."
  };
}

async function compileWithAnthropic({
  agent,
  apiKey,
  conversationId,
  requestSource,
  maxTokens,
  preview,
  source
}: {
  agent: AgentName;
  apiKey: string;
  conversationId: string;
  requestSource: string;
  maxTokens: number;
  preview: Awaited<ReturnType<typeof buildCompactionPreview>>;
  source: CompactionSource;
}) {
  const model = modelForAgent(agent);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...anthropicCacheControl(),
      system: [
        "You are a Room Note compiler for a persistent Agent runtime.",
        "You do not modify data. You do not claim compaction has happened.",
        "Your task is to draft a reviewable Room Note that helps the Agent feel like they blinked, not died.",
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

  await recordModelUsage(getSupabaseAdmin(), {
    provider: "anthropic",
    model: data.model || model,
    agent,
    conversationId,
    turnId: null,
    source: requestSource,
    operation: "compaction_compile",
    round: 0,
    providerRequestId: data.id ?? null,
    stopReason: data.stop_reason ?? null,
    usage: data.usage,
    request: {
      maxTokens,
      messageCount: 1,
      toolCount: 0
    }
  });

  const proposal = extractText(data);
  validateProposalComplete(proposal, data.stop_reason, maxTokens);

  return proposal;
}

function extractText(data: AnthropicResponse) {
  return (data.content ?? [])
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function validateProposalComplete(proposal: string, stopReason: string | undefined, maxTokens: number) {
  if (stopReason === "max_tokens") {
    throw new Error(
      `Room Note hit max_tokens=${maxTokens} before finishing. Retry with a smaller max_chars transcript budget, or pass a larger max_tokens value if the runtime allows it.`
    );
  }

  const requiredTailSections = [
    /(^|\n)\s*(?:#{1,6}\s*)?6\.\s+(?:Candidate durable memories|Durable memory candidates|Candidate memories)/i,
    /(^|\n)\s*(?:#{1,6}\s*)?7\.\s+(?:What can be safely compressed away|Safely compressed away|Compression recommendations)/i
  ];

  if (requiredTailSections.some((pattern) => !pattern.test(proposal))) {
    throw new Error(
      "Room Note did not include required sections 6 and 7. Retry with a smaller max_chars transcript budget or a larger max_tokens value."
    );
  }
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
