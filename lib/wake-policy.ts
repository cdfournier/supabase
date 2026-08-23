export type WakePriority = "loud" | "quiet" | "digest_only" | "silent";
export type WakeTone =
  | "quiet"
  | "soft"
  | "directed"
  | "high_signal"
  | "recovery"
  | "curiosity"
  | "maintenance";

export const WAKE_CONTROL_TRIGGERS = [
  "cafe",
  "operator_note",
  "work_packet_signal",
  "peer_note",
  "outpost",
  "housekeeping",
  "eyes",
  "wheels",
  "bar"
] as const;

export type WakeControlTrigger = typeof WAKE_CONTROL_TRIGGERS[number];

export type WakeControlSwitch = {
  enabled?: boolean;
};

export type WakeMentionPolicy = WakeControlSwitch & {
  names?: string[];
  aliases?: string[];
};

export type WakeTriggerPolicy = WakeControlSwitch & {
  mentions?: WakeMentionPolicy;
};

export type WakeAgentPolicy = WakeControlSwitch & {
  triggers?: Partial<Record<WakeControlTrigger, WakeTriggerPolicy>>;
};

export type WakeControlPolicy = {
  all?: WakeAgentPolicy;
  agents?: Record<string, WakeAgentPolicy>;
};

export type WakePolicyDecision = {
  shouldWake: boolean;
  reason: string;
  matchedMention: string | null;
  agentEnabled: boolean;
  triggerEnabled: boolean;
  mentionEnabled: boolean | null;
};

export type WakePolicyDecisionInput = {
  policy?: WakeControlPolicy | null;
  agentId: string;
  trigger: WakeControlTrigger;
  content?: string | null;
  mentions?: string[] | null;
};

export const WAKE_PRIORITIES: WakePriority[] = ["loud", "quiet", "digest_only", "silent"];
export const WAKE_RECEIPT_REDISPATCH_BLOCKING_STATUSES = ["attempted", "completed"];

export function normalizeWakePriority(value: unknown): WakePriority {
  const priority = String(value ?? "");

  return WAKE_PRIORITIES.includes(priority as WakePriority)
    ? priority as WakePriority
    : "digest_only";
}

export function shouldShowPacketSignalInDigest(wakePriority: unknown) {
  return normalizeWakePriority(wakePriority) !== "silent";
}

export function shouldDispatchNativePacketSignalWake(wakePriority: unknown) {
  const priority = normalizeWakePriority(wakePriority);

  return priority !== "digest_only" && priority !== "silent";
}

export function wakeToneForWorkPacketSignal(packetEventType?: string, wakePriority?: string): WakeTone {
  const priority = normalizeWakePriority(wakePriority);

  if (priority === "silent") {
    return "quiet";
  }

  if (priority === "loud") {
    return "high_signal";
  }

  if (packetEventType === "hold" || packetEventType === "question" || packetEventType === "stale") {
    return "high_signal";
  }

  if (priority === "quiet") {
    return "soft";
  }

  if (packetEventType === "rollup_review") {
    return "quiet";
  }

  if (packetEventType === "open_packet" || packetEventType === "created" || packetEventType === "packet_ready_for_rollup") {
    return "directed";
  }

  return "directed";
}

export function wakePriorityForOperatorNote(): WakePriority {
  return "quiet";
}

export function wakeToneForOperatorNote(): WakeTone {
  return "soft";
}

export function decideWakeFromControlPolicy(input: WakePolicyDecisionInput): WakePolicyDecision {
  const allPolicy = input.policy?.all ?? {};
  const agentPolicy = input.policy?.agents?.[input.agentId] ?? {};
  const triggerPolicy = mergeTriggerPolicy(
    allPolicy.triggers?.[input.trigger],
    agentPolicy.triggers?.[input.trigger]
  );
  const agentEnabled = resolveEnabled(true, allPolicy.enabled, agentPolicy.enabled);
  const triggerEnabled = resolveEnabled(agentEnabled, triggerPolicy.enabled);
  const mentionPolicy = triggerPolicy.mentions ?? {};
  const mentionEnabled = mentionPolicy.enabled;
  const matchedMention = matchWakeMention(input, mentionPolicy);

  if (!agentEnabled) {
    return {
      shouldWake: false,
      reason: "agent_disabled",
      matchedMention,
      agentEnabled,
      triggerEnabled: false,
      mentionEnabled: mentionEnabled ?? null
    };
  }

  if (triggerEnabled) {
    return {
      shouldWake: true,
      reason: "trigger_enabled",
      matchedMention,
      agentEnabled,
      triggerEnabled,
      mentionEnabled: mentionEnabled ?? null
    };
  }

  if (mentionEnabled === true && matchedMention) {
    return {
      shouldWake: true,
      reason: "mention_override",
      matchedMention,
      agentEnabled,
      triggerEnabled,
      mentionEnabled
    };
  }

  return {
    shouldWake: false,
    reason: mentionEnabled === true ? "trigger_disabled_no_mention" : "trigger_disabled",
    matchedMention,
    agentEnabled,
    triggerEnabled,
    mentionEnabled: mentionEnabled ?? null
  };
}

function resolveEnabled(defaultValue: boolean, ...values: Array<boolean | undefined>): boolean {
  return values.reduce<boolean>((current, value) => (
    typeof value === "boolean" ? value : current
  ), defaultValue);
}

function mergeTriggerPolicy(
  base: WakeTriggerPolicy | undefined,
  override: WakeTriggerPolicy | undefined
): WakeTriggerPolicy {
  return {
    ...(base ?? {}),
    ...(override ?? {}),
    mentions: {
      ...(base?.mentions ?? {}),
      ...(override?.mentions ?? {})
    }
  };
}

function matchWakeMention(input: WakePolicyDecisionInput, mentionPolicy: WakeMentionPolicy): string | null {
  const explicitMentions = input.mentions ?? [];
  const names = [...(mentionPolicy.names ?? []), ...(mentionPolicy.aliases ?? [])]
    .map((name) => name.trim())
    .filter(Boolean);

  for (const mention of explicitMentions) {
    const matched = names.find((name) => sameMention(name, mention));
    if (matched) {
      return matched;
    }
  }

  if (!input.content) {
    return null;
  }

  return names.find((name) => contentMentionsName(input.content ?? "", name)) ?? null;
}

function sameMention(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function contentMentionsName(content: string, name: string) {
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(name)}([^\\p{L}\\p{N}_]|$)`, "iu")
    .test(content);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
