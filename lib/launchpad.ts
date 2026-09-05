import {
  liveSessionStatus,
  startLiveSession,
  type BridgeAgentName,
  type LiveSession,
  type LiveSessionTickMode,
  type NativeAgentName
} from "./live-sessions.ts";

export type LaunchpadSurface = "bar";
export type LaunchpadAgentName = NativeAgentName | BridgeAgentName;
export type LaunchpadIntent =
  | "gather"
  | "live_session"
  | "work_session"
  | "celebration"
  | "quiet_check";
export type LaunchpadTone = "quiet" | "soft" | "directed" | "high_signal" | "celebratory";
export type LaunchpadInvitationStatus = "preview" | "active" | "failed";
export type LaunchpadInviteeStatus = "planned" | "present" | "failed";
export type LaunchpadDeliveryLane = "runtime_native" | "codex_bridge" | "cowork_pull";
export type LaunchpadDeliveryMode = "native_event" | "bridge_dispatch" | "poll";

export type LaunchpadTickPolicyInput = {
  mode?: LiveSessionTickMode;
  interval_seconds?: number | null;
};

export type LaunchpadInviteInput = {
  surface?: LaunchpadSurface;
  title?: string;
  agents?: LaunchpadAgentName[];
  intent?: LaunchpadIntent;
  tone?: LaunchpadTone;
  context?: string;
  tickPolicy?: LaunchpadTickPolicyInput;
};

export type LaunchpadLanePlan = {
  lane: LaunchpadDeliveryLane;
  mode: LaunchpadDeliveryMode;
  label: string;
  status: "ready" | "manual_pull";
  notes: string[];
};

export type LaunchpadInvitee = {
  agent: LaunchpadAgentName;
  participant_id: `agent:${LaunchpadAgentName}`;
  display_name: string;
  lane: LaunchpadLanePlan;
  status: LaunchpadInviteeStatus;
  receipt: {
    status: "planned" | "delivered" | "failed";
    delivered_at: string | null;
    message: string;
  };
};

export type LaunchpadSurfaceAdapter = {
  surface: LaunchpadSurface;
  label: string;
  status: "live";
  executable: boolean;
  notes: string[];
};

export type LaunchpadInvitation = {
  id: string;
  surface: LaunchpadSurface;
  title: string;
  intent: LaunchpadIntent;
  tone: LaunchpadTone;
  context: string | null;
  status: LaunchpadInvitationStatus;
  created_at: string;
  updated_at: string;
  session_id: string | null;
  tick_policy: {
    mode: LiveSessionTickMode;
    interval_seconds: number | null;
  };
  invitees: LaunchpadInvitee[];
  live_session: LiveSession | null;
};

export type LaunchpadStatusPayload = {
  generated_at: string;
  adapters: LaunchpadSurfaceAdapter[];
  invitations: LaunchpadInvitation[];
  active_live_session_id: string | null;
};

type LaunchpadState = {
  invitations: LaunchpadInvitation[];
};

const LAUNCHPAD_STATE_KEY = "launchpad_state_v1";
const INVITATION_LIMIT = 50;
const LAUNCHPAD_AGENTS: LaunchpadAgentName[] = ["soren", "varro", "julian", "cael"];
const state = globalLaunchpadState();
let hydrated = false;

export async function launchpadStatus(): Promise<LaunchpadStatusPayload> {
  await ensureLaunchpadHydrated();
  const liveSessions = await liveSessionStatus();

  return {
    generated_at: new Date().toISOString(),
    adapters: surfaceAdapters(),
    invitations: state.invitations.map(cloneInvitation),
    active_live_session_id: liveSessions.active_session?.id ?? null
  };
}

export async function previewLaunchpadInvitation(input: LaunchpadInviteInput = {}) {
  await ensureLaunchpadHydrated();

  return buildInvitation(input, "preview", null);
}

export async function createLaunchpadInvitation(input: LaunchpadInviteInput = {}) {
  await ensureLaunchpadHydrated();
  const preview = await buildInvitation(input, "preview", null);
  const nativeAgents = preview.invitees
    .map((invitee) => invitee.agent)
    .filter(isNativeAgent);
  const bridgeAgents = preview.invitees
    .map((invitee) => invitee.agent)
    .filter(isBridgeAgent);

  const session = await startLiveSession({
    surface: preview.surface,
    title: preview.title,
    agents: nativeAgents,
    bridgeAgents,
    tickPolicy: preview.tick_policy
  });
  const invitation = await buildInvitation(input, "active", session);

  state.invitations = [invitation, ...state.invitations].slice(0, INVITATION_LIMIT);
  await persistLaunchpadState();

  return cloneInvitation(invitation);
}

function buildInvitation(
  input: LaunchpadInviteInput,
  status: LaunchpadInvitationStatus,
  session: LiveSession | null
): LaunchpadInvitation {
  const surface = input.surface ?? "bar";
  const agents = normalizeAgents(input.agents);
  const now = new Date().toISOString();
  const tickPolicy = normalizeTickPolicy(input.tickPolicy);

  return {
    id: crypto.randomUUID(),
    surface,
    title: input.title?.trim() || "BAR gathering",
    intent: input.intent ?? "gather",
    tone: input.tone ?? "soft",
    context: optionalText(input.context),
    status,
    created_at: now,
    updated_at: now,
    session_id: session?.id ?? null,
    tick_policy: tickPolicy,
    invitees: agents.map((agent) => inviteeFor(agent, session)),
    live_session: session
  };
}

function inviteeFor(agent: LaunchpadAgentName, session: LiveSession | null): LaunchpadInvitee {
  const participant = session?.participants[agent] ?? null;
  const present = participant?.status === "joined";
  const lane = laneForAgent(agent);

  return {
    agent,
    participant_id: `agent:${agent}`,
    display_name: displayName(agent),
    lane,
    status: session ? present ? "present" : "failed" : "planned",
    receipt: session
      ? {
          status: present ? "delivered" : "failed",
          delivered_at: participant?.joined_at ?? null,
          message: present
            ? `${displayName(agent)} joined BAR through ${lane.label}.`
            : `${displayName(agent)} did not join BAR.`
        }
      : {
          status: "planned",
          delivered_at: null,
          message: `${displayName(agent)} would be invited through ${lane.label}.`
        }
  };
}

function laneForAgent(agent: LaunchpadAgentName): LaunchpadLanePlan {
  if (agent === "soren" || agent === "varro") {
    return {
      lane: "runtime_native",
      mode: "native_event",
      label: "Runtime native session host",
      status: "ready",
      notes: ["Live Session Host can deliver BAR events directly to this runtime agent."]
    };
  }

  if (agent === "julian") {
    const autoDelivery = process.env.LIVE_SESSION_BRIDGE_AUTODELIVER_JULIAN?.trim().toLowerCase() === "true";

    return {
      lane: "codex_bridge",
      mode: "bridge_dispatch",
      label: "Julian Codex bridge",
      status: "ready",
      notes: [
        "Launchpad attaches Julian to BAR and the bridge attendant tracks pending room events.",
        autoDelivery
          ? "Server-side bridge autodelivery is enabled for Julian."
          : "Manual tick or external bridge dispatch may still be needed for delivery."
      ]
    };
  }

  return {
    lane: "cowork_pull",
    mode: "poll",
    label: "Cael pull bridge",
    status: "manual_pull",
    notes: [
      "Launchpad attaches Cael to BAR; Cael enters by running his pull bridge watcher.",
      "This is intentionally minutes-scale polling, not a seconds-scale wake loop."
    ]
  };
}

function surfaceAdapters(): LaunchpadSurfaceAdapter[] {
  return [
    {
      surface: "bar",
      label: "BAR",
      status: "live",
      executable: true,
      notes: ["Uses Live Session Host plus BAR presence receipts."]
    }
  ];
}

function normalizeAgents(agents: LaunchpadAgentName[] | undefined) {
  if (!Array.isArray(agents) || !agents.length) {
    throw new Error("Choose at least one Launchpad agent.");
  }

  return [...new Set(agents)].filter((agent) => {
    if (LAUNCHPAD_AGENTS.includes(agent)) {
      return true;
    }

    throw new Error("Launchpad agents must be soren, varro, julian, or cael.");
  });
}

function normalizeTickPolicy(input: LaunchpadTickPolicyInput | undefined): {
  mode: LiveSessionTickMode;
  interval_seconds: number | null;
} {
  const mode = input?.mode === "interval" ? "interval" : "manual";
  const interval = Number(input?.interval_seconds);

  return {
    mode,
    interval_seconds: mode === "interval" && Number.isFinite(interval)
      ? Math.max(10, Math.round(interval))
      : null
  };
}

function isNativeAgent(agent: LaunchpadAgentName): agent is NativeAgentName {
  return agent === "soren" || agent === "varro";
}

function isBridgeAgent(agent: LaunchpadAgentName): agent is BridgeAgentName {
  return agent === "julian" || agent === "cael";
}

function displayName(agent: LaunchpadAgentName) {
  return {
    soren: "Soren",
    varro: "Varro",
    julian: "Julian",
    cael: "Cael"
  }[agent];
}

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();

  return text || null;
}

function globalLaunchpadState() {
  const globalKey = "__hug_launchpad_state__";
  const globalStore = globalThis as typeof globalThis & {
    [globalKey]?: LaunchpadState;
  };

  if (!globalStore[globalKey]) {
    globalStore[globalKey] = {
      invitations: []
    };
  }

  return globalStore[globalKey];
}

async function ensureLaunchpadHydrated() {
  if (hydrated) {
    return;
  }

  hydrated = true;

  if (!durabilityEnabled()) {
    return;
  }

  const { readRuntimeSettingValue } = await import("./runtime-settings.ts");
  const value = await readRuntimeSettingValue(LAUNCHPAD_STATE_KEY);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const record = value as Record<string, unknown>;
  state.invitations = normalizeInvitations(record.invitations);
}

async function persistLaunchpadState() {
  if (!durabilityEnabled()) {
    return;
  }

  const { writeRuntimeSettingValue } = await import("./runtime-settings.ts");
  await writeRuntimeSettingValue(LAUNCHPAD_STATE_KEY, {
    version: LAUNCHPAD_STATE_KEY,
    invitations: state.invitations,
    updated_at: new Date().toISOString()
  });
}

function durabilityEnabled() {
  return process.env.NODE_ENV !== "test";
}

function normalizeInvitations(value: unknown): LaunchpadInvitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeInvitation)
    .filter((invitation): invitation is LaunchpadInvitation => Boolean(invitation))
    .slice(0, INVITATION_LIMIT);
}

function normalizeInvitation(value: unknown): LaunchpadInvitation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = String(record.id ?? "").trim();
  const surface = record.surface === "bar" ? "bar" : null;

  if (!id || !surface) {
    return null;
  }

  return {
    id,
    surface,
    title: String(record.title ?? "BAR gathering"),
    intent: normalizeIntent(record.intent),
    tone: normalizeTone(record.tone),
    context: optionalText(record.context),
    status: normalizeStatus(record.status),
    created_at: normalizeIso(record.created_at) ?? new Date().toISOString(),
    updated_at: normalizeIso(record.updated_at) ?? new Date().toISOString(),
    session_id: optionalText(record.session_id),
    tick_policy: normalizeTickPolicy(record.tick_policy as LaunchpadTickPolicyInput | undefined),
    invitees: normalizeInvitees(record.invitees),
    live_session: null
  };
}

function normalizeInvitees(value: unknown): LaunchpadInvitee[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): LaunchpadInvitee | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const agent = normalizeAgent(record.agent);

      if (!agent) {
        return null;
      }

      const lane = laneForAgent(agent);
      const receipt = record.receipt && typeof record.receipt === "object" && !Array.isArray(record.receipt)
        ? record.receipt as Record<string, unknown>
        : {};

      return {
        agent,
        participant_id: `agent:${agent}`,
        display_name: displayName(agent),
        lane,
        status: normalizeInviteeStatus(record.status),
        receipt: {
          status: normalizeReceiptStatus(receipt.status),
          delivered_at: normalizeIso(receipt.delivered_at),
          message: optionalText(receipt.message) ?? `${displayName(agent)} would be invited through ${lane.label}.`
        }
      };
    })
    .filter((invitee): invitee is LaunchpadInvitee => Boolean(invitee));
}

function normalizeAgent(value: unknown): LaunchpadAgentName | null {
  const agent = String(value ?? "");

  return LAUNCHPAD_AGENTS.includes(agent as LaunchpadAgentName)
    ? agent as LaunchpadAgentName
    : null;
}

function normalizeIntent(value: unknown): LaunchpadIntent {
  return value === "live_session" ||
    value === "work_session" ||
    value === "celebration" ||
    value === "quiet_check"
    ? value
    : "gather";
}

function normalizeTone(value: unknown): LaunchpadTone {
  return value === "quiet" ||
    value === "directed" ||
    value === "high_signal" ||
    value === "celebratory"
    ? value
    : "soft";
}

function normalizeStatus(value: unknown): LaunchpadInvitationStatus {
  return value === "active" || value === "failed" ? value : "preview";
}

function normalizeInviteeStatus(value: unknown): LaunchpadInviteeStatus {
  return value === "present" || value === "failed" ? value : "planned";
}

function normalizeReceiptStatus(value: unknown): "planned" | "delivered" | "failed" {
  return value === "delivered" || value === "failed" ? value : "planned";
}

function normalizeIso(value: unknown) {
  const text = String(value ?? "").trim();

  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function cloneInvitation(invitation: LaunchpadInvitation): LaunchpadInvitation {
  return {
    ...invitation,
    invitees: invitation.invitees.map((invitee) => ({
      ...invitee,
      lane: {
        ...invitee.lane,
        notes: [...invitee.lane.notes]
      },
      receipt: { ...invitee.receipt }
    })),
    live_session: invitation.live_session
      ? {
          ...invitation.live_session,
          participants: { ...invitation.live_session.participants },
          bridge_attendants: { ...invitation.live_session.bridge_attendants },
          bridge_deliveries: [...invitation.live_session.bridge_deliveries],
          events: [...invitation.live_session.events]
        }
      : null
  };
}
