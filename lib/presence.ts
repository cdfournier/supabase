export type PresenceSurface =
  | "bar"
  | "cafe"
  | "eyes"
  | "wheels"
  | "world"
  | "work_packets"
  | "housekeeping";

export type PresenceState = "present" | "absent" | "stale" | "degraded" | "unknown";

export type PresenceParticipantType = "operator" | "agent" | "system" | "external_agent";

export type PresenceReceipt = {
  id: string;
  surface: PresenceSurface;
  participant_id: string;
  participant_type: PresenceParticipantType;
  display_name: string;
  declared_state: Exclude<PresenceState, "stale">;
  state: PresenceState;
  source: string;
  since: string;
  last_seen_at: string;
  updated_at: string;
  stale_after_ms: number;
  metadata: Record<string, unknown>;
};

export type PresenceAdapter = {
  surface: PresenceSurface;
  label: string;
  capability: "bar" | "cafe" | "eyes" | "wheels" | "world" | "work_packets" | "housekeeping";
  status: "live" | "dry_run" | "planned";
  accepts: Array<"upsert" | "leave" | "observe">;
  notes: string;
};

export type PresenceUpsertInput = {
  surface: PresenceSurface;
  participant_id: string;
  participant_type?: PresenceParticipantType;
  display_name?: string;
  state?: Exclude<PresenceState, "stale">;
  source?: string;
  now?: Date;
  stale_after_ms?: number;
  metadata?: Record<string, unknown>;
};

export type PresenceListOptions = {
  surface?: PresenceSurface;
  now?: Date;
};

type PresenceRegistry = {
  adapters: Map<PresenceSurface, PresenceAdapter>;
  receipts: Map<string, PresenceReceipt>;
};

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const registry = globalPresenceRegistry();

registerPresenceAdapter({
  surface: "bar",
  label: "BAR",
  capability: "bar",
  status: "live",
  accepts: ["upsert", "leave"],
  notes: "First Camp 1 proof surface. BAR updates Presence through this contract."
});

registerPresenceAdapter({
  surface: "eyes",
  label: "EYES",
  capability: "eyes",
  status: "live",
  accepts: ["upsert", "leave", "observe"],
  notes: "Camp 2 runtime-native observer surface. Operator controls capture; agents join, read frames, and observe."
});

registerPresenceAdapter({
  surface: "wheels",
  label: "WHEELS",
  capability: "wheels",
  status: "dry_run",
  accepts: ["upsert", "leave", "observe"],
  notes: "Dry-run adapter contract for supervised wheel possession; not wired to PiCar yet."
});

export function registerPresenceAdapter(adapter: PresenceAdapter) {
  registry.adapters.set(adapter.surface, adapter);
}

export function listPresenceAdapters() {
  return [...registry.adapters.values()].sort((a, b) => a.surface.localeCompare(b.surface));
}

export function upsertPresenceReceipt(input: PresenceUpsertInput) {
  const now = input.now ?? new Date();
  const isoNow = now.toISOString();
  const key = presenceKey(input.surface, input.participant_id);
  const existing = registry.receipts.get(key);
  const declaredState = input.state ?? "present";

  const receipt: PresenceReceipt = evaluatePresence(
    {
      id: existing?.id ?? crypto.randomUUID(),
      surface: input.surface,
      participant_id: input.participant_id,
      participant_type: input.participant_type ?? existing?.participant_type ?? "agent",
      display_name: input.display_name ?? existing?.display_name ?? displayNameFor(input.participant_id),
      declared_state: declaredState,
      state: declaredState,
      source: input.source ?? existing?.source ?? "presence_layer",
      since: existing && existing.declared_state === declaredState ? existing.since : isoNow,
      last_seen_at: isoNow,
      updated_at: isoNow,
      stale_after_ms: input.stale_after_ms ?? existing?.stale_after_ms ?? DEFAULT_STALE_AFTER_MS,
      metadata: {
        ...(existing?.metadata ?? {}),
        ...(input.metadata ?? {})
      }
    },
    now
  );

  registry.receipts.set(key, receipt);

  return receipt;
}

export function leavePresence(input: Omit<PresenceUpsertInput, "state">) {
  return upsertPresenceReceipt({
    ...input,
    state: "absent",
    source: input.source ?? "presence_leave"
  });
}

export function listPresence(options: PresenceListOptions = {}) {
  const now = options.now ?? new Date();

  return [...registry.receipts.values()]
    .filter((receipt) => !options.surface || receipt.surface === options.surface)
    .map((receipt) => evaluatePresence(receipt, now))
    .sort((a, b) => {
      if (a.surface !== b.surface) {
        return a.surface.localeCompare(b.surface);
      }

      return a.display_name.localeCompare(b.display_name);
    });
}

export function exportPresenceReceipts() {
  return [...registry.receipts.values()].map((receipt) => ({
    ...receipt,
    metadata: { ...receipt.metadata }
  }));
}

export function importPresenceReceipts(receipts: unknown) {
  if (!Array.isArray(receipts)) {
    return;
  }

  for (const candidate of receipts) {
    const receipt = normalizePresenceReceipt(candidate);

    if (receipt) {
      registry.receipts.set(presenceKey(receipt.surface, receipt.participant_id), receipt);
    }
  }
}

export function evaluatePresence(receipt: PresenceReceipt, now = new Date()): PresenceReceipt {
  if (receipt.declared_state === "present" || receipt.declared_state === "degraded") {
    const lastSeen = Date.parse(receipt.last_seen_at);
    const age = Number.isFinite(lastSeen) ? now.getTime() - lastSeen : Number.POSITIVE_INFINITY;

    if (age > receipt.stale_after_ms) {
      return {
        ...receipt,
        state: "stale"
      };
    }
  }

  return {
    ...receipt,
    state: receipt.declared_state
  };
}

function presenceKey(surface: PresenceSurface, participantId: string) {
  return `${surface}:${participantId}`;
}

function displayNameFor(participantId: string) {
  const value = participantId.split(":").at(-1) ?? participantId;

  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function normalizePresenceReceipt(value: unknown): PresenceReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const surface = normalizePresenceSurface(record.surface);
  const declaredState = normalizeDeclaredState(record.declared_state);

  if (!surface || !declaredState) {
    return null;
  }

  const participantId = String(record.participant_id ?? "").trim();

  if (!participantId) {
    return null;
  }

  return {
    id: String(record.id ?? crypto.randomUUID()),
    surface,
    participant_id: participantId,
    participant_type: normalizeParticipantType(record.participant_type),
    display_name: String(record.display_name ?? displayNameFor(participantId)),
    declared_state: declaredState,
    state: declaredState,
    source: String(record.source ?? "presence_restore"),
    since: normalizeIso(record.since) ?? new Date().toISOString(),
    last_seen_at: normalizeIso(record.last_seen_at) ?? new Date().toISOString(),
    updated_at: normalizeIso(record.updated_at) ?? new Date().toISOString(),
    stale_after_ms: normalizePositiveNumber(record.stale_after_ms, DEFAULT_STALE_AFTER_MS),
    metadata: normalizeMetadata(record.metadata)
  };
}

function normalizePresenceSurface(value: unknown): PresenceSurface | null {
  if (
    value === "bar" ||
    value === "cafe" ||
    value === "eyes" ||
    value === "wheels" ||
    value === "world" ||
    value === "work_packets" ||
    value === "housekeeping"
  ) {
    return value;
  }

  return null;
}

function normalizeDeclaredState(value: unknown): Exclude<PresenceState, "stale"> | null {
  if (value === "present" || value === "absent" || value === "degraded" || value === "unknown") {
    return value;
  }

  return null;
}

function normalizeParticipantType(value: unknown): PresenceParticipantType {
  if (value === "operator" || value === "agent" || value === "system" || value === "external_agent") {
    return value;
  }

  return "agent";
}

function normalizeIso(value: unknown) {
  const text = String(value ?? "").trim();

  return Number.isFinite(Date.parse(text)) ? text : null;
}

function normalizePositiveNumber(value: unknown, fallback: number) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function globalPresenceRegistry() {
  const globalKey = "__hug_presence_registry__";
  const globalStore = globalThis as typeof globalThis & {
    [globalKey]?: PresenceRegistry;
  };

  if (!globalStore[globalKey]) {
    globalStore[globalKey] = {
      adapters: new Map(),
      receipts: new Map()
    };
  }

  return globalStore[globalKey];
}
