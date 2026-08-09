import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  actorFromId,
  commentOnWorkPacket,
  getWorkPacket,
  listWorkPackets,
  respondToWorkPacket
} from "@/lib/work-packets";

const TOOL_PACKET_LIMIT = 12;

export async function listRuntimeWorkPackets(agent: AgentName, input: unknown) {
  const packets = await listWorkPackets(getSupabaseAdmin(), {
    ...(isRecord(input) ? input : {}),
    limit: clampNumber(isRecord(input) ? input.limit : undefined, TOOL_PACKET_LIMIT, 1, TOOL_PACKET_LIMIT)
  });

  return stringifyToolPayload({
    note:
      "Operator-visible work packets. These are invitations, not assignments. Passing, deferring, or reading with nothing to add are valid responses.",
    active_agent: agent,
    packets: packets.map((packet) => ({
      id: packet.id,
      packet_key: packet.packet_key,
      title: packet.title,
      objective: packet.objective,
      context: packet.context,
      repo: packet.repo,
      status: packet.status,
      wake_priority: packet.wake_priority,
      owner_agent: packet.owner_agent,
      conductor: packet.conductor,
      collaborators: packet.collaborators,
      allowed_paths: packet.allowed_paths,
      done_criteria: packet.done_criteria,
      updated_at: packet.updated_at
    }))
  });
}

export async function getRuntimeWorkPacket(agent: AgentName, input: unknown) {
  const packet = await getWorkPacket(getSupabaseAdmin(), input);

  return stringifyToolPayload({
    note:
      "Work packet detail and event trail. Comments are audit trail; the conductor rollup is the founder-facing surface.",
    active_agent: agent,
    ...packet
  });
}

export async function respondToRuntimeWorkPacket(agent: AgentName, input: unknown) {
  const packet = await respondToWorkPacket(getSupabaseAdmin(), input, actorFromId(`agent:${agent}`));

  return stringifyToolPayload({
    note:
      "Work packet response recorded. Pass, defer, no_comment, question, and hold are all first-class response states.",
    active_agent: agent,
    ...packet
  });
}

export async function commentOnRuntimeWorkPacket(agent: AgentName, input: unknown) {
  const packet = await commentOnWorkPacket(getSupabaseAdmin(), input, actorFromId(`agent:${agent}`));

  return stringifyToolPayload({
    note: "Work packet comment recorded. Use hold=true only when the packet should wait for conductor attention.",
    active_agent: agent,
    ...packet
  });
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringifyToolPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}
