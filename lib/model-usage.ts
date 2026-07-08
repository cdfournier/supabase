import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentName } from "@/lib/agent-context";

export type ModelUsageInput = {
  provider: string;
  model: string;
  agent: AgentName;
  conversationId: string;
  turnId?: string | null;
  source: string;
  operation: string;
  round?: number | null;
  providerRequestId?: string | null;
  stopReason?: string | null;
  ok?: boolean;
  usage: unknown;
  request: {
    maxTokens?: number | null;
    messageCount?: number | null;
    toolCount?: number | null;
  };
};

export type UsageTotals = {
  table_present: boolean;
  error: string | null;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
};

export type UsageEventSummary = {
  id: string;
  provider: string;
  model: string;
  source: string;
  operation: string;
  round: number | null;
  turn_id: string | null;
  stop_reason: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  created_at: string;
};

type AnthropicUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
};

type UsageRow = {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
};

type UsageEventRow = UsageRow & {
  id: string;
  provider: string;
  model: string;
  source: string;
  operation: string;
  round: number | null;
  turn_id: string | null;
  stop_reason: string | null;
  created_at: string;
};

const USAGE_PAGE_SIZE = 1000;

const ZERO_TOTALS: UsageTotals = {
  table_present: true,
  error: null,
  calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_tokens: 0
};

export async function recordModelUsage(
  supabase: SupabaseClient,
  input: ModelUsageInput
) {
  const usage = normalizeAnthropicUsage(input.usage);
  const { error } = await supabase.from("model_usage_events").insert({
    provider: input.provider,
    model: input.model,
    agent: input.agent,
    conversation_id: input.conversationId,
    turn_id: input.turnId ?? null,
    source: input.source,
    operation: input.operation,
    round: input.round ?? null,
    provider_request_id: input.providerRequestId ?? null,
    stop_reason: input.stopReason ?? null,
    ok: input.ok ?? true,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_tokens: usage.cacheReadTokens,
    cache_creation_tokens: usage.cacheCreationTokens,
    raw_usage: normalizeJsonRecord(input.usage),
    request_summary: normalizeJsonRecord(input.request)
  });

  if (error) {
    console.warn(`Could not record model usage: ${error.message}`);
  }
}

export async function loadUsageTotals(
  supabase: SupabaseClient,
  agent?: AgentName
): Promise<UsageTotals> {
  const rows: UsageRow[] = [];
  let exactCount: number | null = null;

  for (let offset = 0; ; offset += USAGE_PAGE_SIZE) {
    let query = supabase
      .from("model_usage_events")
      .select("input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens", {
        count: offset === 0 ? "exact" : undefined,
        head: false
      })
      .order("created_at", { ascending: true })
      .range(offset, offset + USAGE_PAGE_SIZE - 1);

    if (agent) {
      query = query.eq("agent", agent);
    }

    const { data, error, count } = await query;

    if (error) {
      return {
        ...ZERO_TOTALS,
        table_present: !isMissingTableError(error),
        error: error.message
      };
    }

    if (exactCount === null) {
      exactCount = count ?? null;
    }

    rows.push(...((data ?? []) as UsageRow[]));

    if (!data || data.length < USAGE_PAGE_SIZE) {
      break;
    }
  }

  const totals = rows.reduce<UsageTotals>(
    (current, row) => addUsageRow(current, row as UsageRow),
    { ...ZERO_TOTALS }
  );

  return {
    ...totals,
    calls: exactCount ?? rows.length
  };
}

export async function loadRecentUsageEvents(
  supabase: SupabaseClient,
  agent: AgentName,
  limit: number
): Promise<{
  table_present: boolean;
  error: string | null;
  events: UsageEventSummary[];
}> {
  const { data, error } = await supabase
    .from("model_usage_events")
    .select(
      "id, provider, model, source, operation, round, turn_id, stop_reason, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, created_at"
    )
    .eq("agent", agent)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return {
      table_present: !isMissingTableError(error),
      error: error.message,
      events: []
    };
  }

  return {
    table_present: true,
    error: null,
    events: ((data ?? []) as UsageEventRow[]).map(summarizeUsageEvent)
  };
}

function addUsageRow(totals: UsageTotals, row: UsageRow): UsageTotals {
  const inputTokens = totals.input_tokens + numberValue(row.input_tokens);
  const outputTokens = totals.output_tokens + numberValue(row.output_tokens);
  const cacheReadTokens = totals.cache_read_tokens + numberValue(row.cache_read_tokens);
  const cacheCreationTokens = totals.cache_creation_tokens + numberValue(row.cache_creation_tokens);

  return {
    ...totals,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheCreationTokens,
    total_tokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  };
}

function summarizeUsageEvent(row: UsageEventRow): UsageEventSummary {
  const inputTokens = numberValue(row.input_tokens);
  const outputTokens = numberValue(row.output_tokens);
  const cacheReadTokens = numberValue(row.cache_read_tokens);
  const cacheCreationTokens = numberValue(row.cache_creation_tokens);

  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    source: row.source,
    operation: row.operation,
    round: row.round,
    turn_id: row.turn_id,
    stop_reason: row.stop_reason,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheCreationTokens,
    total_tokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    created_at: row.created_at
  };
}

function normalizeAnthropicUsage(usage: unknown) {
  const value = isRecord(usage) ? (usage as AnthropicUsage) : {};

  return {
    inputTokens: numberValue(value.input_tokens),
    outputTokens: numberValue(value.output_tokens),
    cacheReadTokens: numberValue(value.cache_read_input_tokens),
    cacheCreationTokens: numberValue(value.cache_creation_input_tokens)
  };
}

function numberValue(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function normalizeJsonRecord(value: unknown) {
  if (value === undefined) {
    return {};
  }

  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingTableError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find.*model_usage_events|relation .*model_usage_events.* does not exist/i.test(
      error.message ?? ""
    )
  );
}
