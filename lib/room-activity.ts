import type { AgentName } from "@/lib/agent-context";

export type RoomActivityKind = "chat_turn" | "free_moment" | "room_refresh";

export type RoomActivity = {
  agent: AgentName;
  id: string;
  kind: RoomActivityKind;
  started_at: string;
};

type RuntimeGlobal = typeof globalThis & {
  __runtimeRoomActivities?: Map<AgentName, RoomActivity>;
};

/**
 * The in-process ownership gate for a single agent room. Durable receipts
 * remain the record of what happened; this registry makes concurrent work
 * wait before it can create a conflicting transition in this runtime.
 */
export function claimRoomActivity(input: Omit<RoomActivity, "started_at">) {
  const activities = roomActivities();
  const active = activities.get(input.agent);

  if (active) {
    return { active, claimed: false as const };
  }

  const activity: RoomActivity = {
    ...input,
    started_at: new Date().toISOString()
  };
  activities.set(activity.agent, activity);
  return { active: activity, claimed: true as const };
}

export function activeRoomActivity(agent: AgentName) {
  return roomActivities().get(agent) ?? null;
}

export function releaseRoomActivity(agent: AgentName, id: string) {
  const activities = roomActivities();
  const active = activities.get(agent);

  if (!active || active.id !== id) {
    return false;
  }

  activities.delete(agent);
  return true;
}

export function resetRoomActivitiesForTest() {
  roomActivities().clear();
}

function roomActivities() {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal.__runtimeRoomActivities ??= new Map<AgentName, RoomActivity>();
  return runtimeGlobal.__runtimeRoomActivities;
}
