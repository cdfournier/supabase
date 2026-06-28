export const ANTHROPIC_PROMPT_CACHE_TTL = "5m";

export function anthropicPromptCacheEnabled() {
  const value = process.env.ANTHROPIC_PROMPT_CACHE;

  if (!value) {
    return true;
  }

  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function anthropicCacheControl() {
  return anthropicPromptCacheEnabled()
    ? {
        cache_control: {
          type: "ephemeral"
        }
      }
    : {};
}
