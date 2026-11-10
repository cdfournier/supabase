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
  runtimeInstanceId?: string | null;
  coldStart?: boolean;
  latencyMs?: number | null;
  failureKind?: string | null;
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
  successful_calls: number;
  failed_calls: number;
  cold_start_calls: number;
  priced_calls: number;
  unpriced_calls: number;
  estimated_cost_usd: number;
  total_latency_ms: number;
  average_latency_ms: number | null;
  cache_read_percent: number | null;
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
  ok: boolean;
  cold_start: boolean;
  latency_ms: number | null;
  failure_kind: string | null;
  estimated_cost_usd: number | null;
  created_at: string;
};

export type UsageWindows = {
  last_24_hours: UsageTotals;
  last_7_days: UsageTotals;
  lifetime: UsageTotals;
};

export type UsageBudgetStatus = {
  table_present: boolean;
  error: string | null;
  policies: Array<{
    scope: "global" | "agent";
    agent: AgentName | null;
    window_hours: 24 | 168;
    enabled: boolean;
    limit_usd: number | null;
    warning_percent: number;
    estimated_cost_usd: number;
    percent_of_limit: number | null;
    status: "disabled" | "unpriced" | "ok" | "warning" | "over_limit";
  }>;
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
  ok: boolean | null;
  cold_start: boolean | null;
  latency_ms: number | null;
  failure_kind: string | null;
  rate_snapshot: unknown;
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

type PricingRateRow = {
  provider: string;
  model: string;
  currency: string;
  input_per_million: number | string;
  output_per_million: number | string;
  cache_read_per_million: number | string;
  cache_creation_per_million: number | string;
  cache_ttl: string;
  effective_at: string;
  source_url: string;
};

type BudgetPolicyRow = {
  scope: "global" | "agent";
  agent: AgentName | null;
  window_hours: 24 | 168;
  limit_usd: number | string | null;
  warning_percent: number;
  enabled: boolean;
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
  total_tokens: 0,
  successful_calls: 0,
  failed_calls: 0,
  cold_start_calls: 0,
  priced_calls: 0,
  unpriced_calls: 0,
  estimated_cost_usd: 0,
  total_latency_ms: 0,
  average_latency_ms: null,
  cache_read_percent: null
};

export async function recordModelUsage(
  supabase: SupabaseClient,
  input: ModelUsageInput
) {
  const usage = normalizeAnthropicUsage(input.usage);
  const rateSnapshot = await resolveRateSnapshot(supabase, input.provider, input.model, usage);
  const row = {
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
    request_summary: normalizeJsonRecord(input.request),
    runtime_instance_id: input.runtimeInstanceId ?? null,
    cold_start: input.coldStart ?? false,
    latency_ms: normalizedLatency(input.latencyMs),
    failure_kind: input.failureKind ?? null,
    rate_snapshot: rateSnapshot
  };

  let { error } = await supabase.from("model_usage_events").insert(row);

  // Existing deployments keep collecting the original usage trail until this
  // additive migration lands. Observability must never make a live turn fail.
  if (error && isMissingDecisionSupportColumn(error)) {
    ({ error } = await supabase.from("model_usage_events").insert({
      provider: row.provider,
      model: row.model,
      agent: row.agent,
      conversation_id: row.conversation_id,
      turn_id: row.turn_id,
      source: row.source,
      operation: row.operation,
      round: row.round,
      provider_request_id: row.provider_request_id,
      stop_reason: row.stop_reason,
      ok: row.ok,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_read_tokens: row.cache_read_tokens,
      cache_creation_tokens: row.cache_creation_tokens,
      raw_usage: row.raw_usage,
      request_summary: row.request_summary
    }));
  }

  if (error) {
    console.warn(`Could not record model usage: ${error.message}`);
  }
}

export async function loadUsageTotals(
  supabase: SupabaseClient,
  agent?: AgentName,
  options: { since?: string } = {}
): Promise<UsageTotals> {
  const rows: UsageRow[] = [];
  let exactCount: number | null = null;

  for (let offset = 0; ; offset += USAGE_PAGE_SIZE) {
    let query = supabase
      .from("model_usage_events")
      .select("input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, ok, cold_start, latency_ms, failure_kind, rate_snapshot", {
        count: offset === 0 ? "exact" : undefined,
        head: false
      })
      .order("created_at", { ascending: true })
      .range(offset, offset + USAGE_PAGE_SIZE - 1);

    if (agent) {
      query = query.eq("agent", agent);
    }
    if (options.since) {
      query = query.gte("created_at", options.since);
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

  const calls = exactCount ?? rows.length;
  const totalLatency = totals.total_latency_ms;
  const promptTokens = totals.input_tokens + totals.cache_read_tokens + totals.cache_creation_tokens;

  return {
    ...totals,
    calls,
    average_latency_ms: calls ? Math.round(totalLatency / calls) : null,
    cache_read_percent: promptTokens
      ? roundPercent((totals.cache_read_tokens / promptTokens) * 100)
      : null
  };
}

export async function loadUsageWindows(
  supabase: SupabaseClient,
  agent?: AgentName
): Promise<UsageWindows> {
  const now = Date.now();
  const [last24Hours, last7Days, lifetime] = await Promise.all([
    loadUsageTotals(supabase, agent, { since: new Date(now - 24 * 60 * 60 * 1000).toISOString() }),
    loadUsageTotals(supabase, agent, { since: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString() }),
    loadUsageTotals(supabase, agent)
  ]);

  return {
    last_24_hours: last24Hours,
    last_7_days: last7Days,
    lifetime
  };
}

export async function loadUsageBudgetStatus(
  supabase: SupabaseClient,
  agent?: AgentName
): Promise<UsageBudgetStatus> {
  let query = supabase
    .from("runtime_accounting_budget_policies")
    .select("scope, agent, window_hours, limit_usd, warning_percent, enabled")
    .order("scope", { ascending: true })
    .order("window_hours", { ascending: true });

  if (agent) {
    query = query.or(`scope.eq.global,agent.eq.${agent}`);
  }

  const { data, error } = await query;
  if (error) {
    return {
      table_present: !isMissingBudgetPolicyTableError(error),
      error: error.message,
      policies: []
    };
  }

  const policies = (data ?? []) as BudgetPolicyRow[];
  const resolved = await Promise.all(
    policies.map(async (policy) => {
      const since = new Date(Date.now() - policy.window_hours * 60 * 60 * 1000).toISOString();
      const totals = await loadUsageTotals(
        supabase,
        policy.scope === "agent" ? policy.agent ?? undefined : undefined,
        { since }
      );
      const limitUsd = nullableNumber(policy.limit_usd);
      const percent = limitUsd && limitUsd > 0
        ? roundPercent((totals.estimated_cost_usd / limitUsd) * 100)
        : null;
      const status: UsageBudgetStatus["policies"][number]["status"] = !policy.enabled || !limitUsd
        ? "disabled"
        : totals.unpriced_calls > 0
          ? "unpriced"
          : percent !== null && percent >= 100
            ? "over_limit"
            : percent !== null && percent >= policy.warning_percent
              ? "warning"
              : "ok";

      return {
        scope: policy.scope,
        agent: policy.agent,
        window_hours: policy.window_hours,
        enabled: policy.enabled,
        limit_usd: limitUsd,
        warning_percent: policy.warning_percent,
        estimated_cost_usd: totals.estimated_cost_usd,
        percent_of_limit: percent,
        status
      };
    })
  );

  return { table_present: true, error: null, policies: resolved };
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
      "id, provider, model, source, operation, round, turn_id, stop_reason, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, ok, cold_start, latency_ms, failure_kind, rate_snapshot, created_at"
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
  const ok = row.ok !== false;
  const latencyMs = numberValue(row.latency_ms);
  const estimatedCost = rateSnapshotCost(row.rate_snapshot);

  return {
    ...totals,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheCreationTokens,
    total_tokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    successful_calls: totals.successful_calls + (ok ? 1 : 0),
    failed_calls: totals.failed_calls + (ok ? 0 : 1),
    cold_start_calls: totals.cold_start_calls + (row.cold_start === true ? 1 : 0),
    priced_calls: totals.priced_calls + (estimatedCost === null ? 0 : 1),
    unpriced_calls: totals.unpriced_calls + (estimatedCost === null ? 1 : 0),
    estimated_cost_usd: roundUsd(totals.estimated_cost_usd + (estimatedCost ?? 0)),
    total_latency_ms: totals.total_latency_ms + latencyMs
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
    ok: row.ok !== false,
    cold_start: row.cold_start === true,
    latency_ms: row.latency_ms === null ? null : numberValue(row.latency_ms),
    failure_kind: row.failure_kind ?? null,
    estimated_cost_usd: rateSnapshotCost(row.rate_snapshot),
    created_at: row.created_at
  };
}

async function resolveRateSnapshot(
  supabase: SupabaseClient,
  provider: string,
  model: string,
  usage: ReturnType<typeof normalizeAnthropicUsage>
) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("model_pricing_rates")
    .select(
      "provider, model, currency, input_per_million, output_per_million, cache_read_per_million, cache_creation_per_million, cache_ttl, effective_at, source_url"
    )
    .eq("provider", provider)
    .eq("model", model)
    .lte("effective_at", now)
    .or(`retired_at.is.null,retired_at.gt.${now}`)
    .order("effective_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { priced: false };
  }

  const rate = data as PricingRateRow;
  const inputRate = nullableNumber(rate.input_per_million) ?? 0;
  const outputRate = nullableNumber(rate.output_per_million) ?? 0;
  const cacheReadRate = nullableNumber(rate.cache_read_per_million) ?? 0;
  const cacheCreationRate = nullableNumber(rate.cache_creation_per_million) ?? 0;
  const estimatedCost =
    (usage.inputTokens / 1_000_000) * inputRate +
    (usage.outputTokens / 1_000_000) * outputRate +
    (usage.cacheReadTokens / 1_000_000) * cacheReadRate +
    (usage.cacheCreationTokens / 1_000_000) * cacheCreationRate;

  return {
    priced: true,
    currency: rate.currency,
    estimated_cost_usd: roundUsd(estimatedCost),
    rates_per_million: {
      input: inputRate,
      output: outputRate,
      cache_read: cacheReadRate,
      cache_creation: cacheCreationRate
    },
    cache_ttl: rate.cache_ttl,
    effective_at: rate.effective_at,
    source_url: rate.source_url
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

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizedLatency(value: number | null | undefined) {
  const numeric = nullableNumber(value);
  return numeric === null || numeric < 0 ? null : Math.floor(numeric);
}

function rateSnapshotCost(value: unknown) {
  if (!isRecord(value) || value.priced !== true) {
    return null;
  }
  return nullableNumber(value.estimated_cost_usd);
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function normalizeJsonRecord(value: unknown) {
  if (value === undefined) {
    return {};
  }

  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

function isMissingDecisionSupportColumn(error: { code?: string; message?: string }) {
  const message = error.message ?? "";
  return error.code === "PGRST204" || /runtime_instance_id|cold_start|latency_ms|failure_kind|rate_snapshot/i.test(message);
}

function isMissingBudgetPolicyTableError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /runtime_accounting_budget_policies.*does not exist|could not find.*runtime_accounting_budget_policies/i.test(
      error.message ?? ""
    )
  );
}
