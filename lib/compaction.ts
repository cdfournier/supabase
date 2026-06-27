export const PRESSURE_WARN_CHARS = 60_000;
export const PRESSURE_HIGH_CHARS = 120_000;

export function compactionPressure(savedCharacters: number) {
  if (savedCharacters >= PRESSURE_HIGH_CHARS) {
    return {
      level: "high" as const,
      percent: 100,
      note: "Manual compaction planning should happen before this grows much further."
    };
  }

  if (savedCharacters >= PRESSURE_WARN_CHARS) {
    return {
      level: "medium" as const,
      percent: Math.round((savedCharacters / PRESSURE_HIGH_CHARS) * 100),
      note: "Conversation is getting warm. Compaction is still disabled."
    };
  }

  return {
    level: "low" as const,
    percent: Math.round((savedCharacters / PRESSURE_HIGH_CHARS) * 100),
    note: "No compaction pressure yet. Compaction is still disabled."
  };
}

export function clampText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 18)).trimEnd()} [truncated]`;
}
