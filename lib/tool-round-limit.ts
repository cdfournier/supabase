export type ToolRoundLimit = number | null;

const DEFAULT_TOOL_ROUND_LIMIT = 6;

/**
 * Parses ANTHROPIC_MAX_TOOL_ROUNDS without making an absent or invalid value
 * accidentally mean "unlimited." `none` is the one explicit unbounded value.
 */
export function toolRoundLimitFromEnv(
  value: string | undefined,
  fallback = DEFAULT_TOOL_ROUND_LIMIT
): ToolRoundLimit {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "none") {
    return null;
  }

  if (!normalized) {
    return fallback;
  }

  const numericValue = Number(normalized);

  return Number.isFinite(numericValue) && numericValue >= 0
    ? Math.floor(numericValue)
    : fallback;
}

export function toolRoundLimitLabel(limit: ToolRoundLimit) {
  return limit === null ? "none" : String(limit);
}

export function shouldSettleBeforeToolCall(limit: ToolRoundLimit, round: number) {
  return limit !== null && round > limit;
}

export function shouldSettleAfterToolUse(limit: ToolRoundLimit, round: number) {
  return limit !== null && round === limit;
}
