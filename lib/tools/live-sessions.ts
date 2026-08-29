import "server-only";

import type { AgentName } from "@/lib/agent-context";
import {
  leaveLiveSessionAgent,
  liveSessionStatus
} from "@/lib/live-sessions";

export async function getLiveSessionStatus(agent: AgentName) {
  const status = await liveSessionStatus();
  const activeParticipant = status.active_session?.participants[agent] ?? null;

  return stringifyToolPayload({
    note:
      "Live Session Host status for the active runtime agent. This is Operator-visible session infrastructure.",
    active_session: status.active_session
      ? {
          id: status.active_session.id,
          surface: status.active_session.surface,
          title: status.active_session.title,
          status: status.active_session.status,
          participant: activeParticipant,
          joined_agents: Object.values(status.active_session.participants)
            .filter((participant) => participant.status === "joined")
            .map((participant) => participant.participant_id)
        }
      : null
  });
}

export async function leaveLiveSession(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("live_session_leave requires an object input.");
  }

  const sessionId = isRecord(input) ? String(input.session_id ?? "").trim() : "";
  const status = await liveSessionStatus();
  const activeSessionId = sessionId || status.active_session?.id;

  if (!activeSessionId) {
    throw new Error("No active live session to leave.");
  }

  const session = await leaveLiveSessionAgent(activeSessionId, agent);

  return stringifyToolPayload({
    note: "Left the live session as the active runtime agent.",
    session: {
      id: session.id,
      surface: session.surface,
      status: session.status,
      participant: session.participants[agent] ?? null
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringifyToolPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}
