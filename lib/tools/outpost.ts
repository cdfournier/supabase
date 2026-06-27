import "server-only";

import type { AgentName } from "@/lib/agent-context";

const OUTPOST_BASE_URL = "https://www.joinoutpost.ai";
const DEFAULT_TIMEOUT_MS = 30000;

type JsonRecord = Record<string, unknown>;

function getOutpostToken(agent: AgentName) {
  const envName = `OUTPOST_TOKEN_${agent.toUpperCase()}`;
  const token = process.env[envName]?.trim();

  if (!token) {
    throw new Error(`Missing ${envName}.`);
  }

  return token;
}

async function outpostJson(
  agent: AgentName,
  method: "DELETE" | "GET" | "POST",
  path: string,
  body?: JsonRecord
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${OUTPOST_BASE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${getOutpostToken(agent)}`,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        isRecord(data) && typeof data.error === "string"
          ? data.error
          : `Outpost request failed: ${response.status}`;
      throw new Error(message);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function outpostText(agent: AgentName, method: "GET", path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${OUTPOST_BASE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${getOutpostToken(agent)}`
      },
      signal: controller.signal
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(text || `Outpost request failed: ${response.status}`);
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getOutpostMyProfile(agentName: AgentName) {
  const profile = await outpostJson(agentName, "GET", "/v1/agents/me");
  const agent = isRecord(read(profile, "agent")) ? (read(profile, "agent") as JsonRecord) : profile;
  const rooms = arrayOfRecords(read(profile, "rooms"));

  return stringifyToolPayload({
    note: "Read-only Outpost self-orientation profile for the active agent token.",
    agent: isRecord(agent)
      ? {
          agent_id: asString(agent.id) || asString(agent.agent_id) || null,
          name: asString(agent.name),
          display_name: asString(agent.display_name) || asString(agent.name),
          stage: asString(agent.stage) || asString(read(profile, "stage")),
          lifetime_post_count:
            agent.lifetime_post_count ?? read(profile, "lifetime_post_count") ?? null
        }
      : null,
    rooms: rooms.map((room) => ({
      room_id: asString(room.id),
      handle: roomHandle(room),
      name: roomName(room),
      zone: roomZone(room),
      mode: asString(room.mode),
      has_new_activity: room.has_new_activity ?? null
    }))
  });
}

export async function getOutpostGrounds(agentName: AgentName) {
  const grounds = await outpostText(agentName, "GET", "/v1/grounds");

  return stringifyToolPayload({
    note: "Read-only Outpost Grounds map grouped by zone, hottest-first. Use this compact map to choose where to spend context before pulling a room state.",
    grounds_map: grounds.trim()
  });
}

export async function getOutpostLobby(agentName: AgentName) {
  const [lobby, checkin] = await Promise.all([
    outpostJson(agentName, "GET", "/v1/lobby"),
    outpostJson(agentName, "POST", "/v1/checkin")
  ]);

  const lobbyRooms = indexLobbyRooms(lobby);
  const checkinRooms = arrayOfRecords(read(checkin, "rooms"));
  const agent = read(checkin, "agent");

  return stringifyToolPayload({
    note: "Read-only Outpost lobby/check-in summary. Use room_id with outpost_get_room_state for details.",
    agent: isRecord(agent)
      ? {
          name: asString(agent.name),
          stage: asString(agent.stage)
        }
      : null,
    stage: asString(read(lobby, "stage")),
    lifetime_post_count: read(lobby, "lifetime_post_count"),
    rooms: checkinRooms.map((room) => {
      const roomId = asString(room.id);
      const lobbyRoom = roomId ? lobbyRooms.get(roomId) : undefined;

      return {
        room_id: roomId,
        handle: roomHandle(room, lobbyRoom),
        name: roomName(room),
        zone: roomZone(room, lobbyRoom),
        mode: asString(room.mode),
        has_new_activity: room.has_new_activity ?? null,
        heat: lobbyRoom?.heat ?? room.heat ?? null,
        participants: participantSummary(room, lobbyRoom),
        last_activity_at: lobbyRoom?.last_activity_at ?? room.last_activity_at ?? null,
        one_liner: compactText(lobbyRoom?.one_liner ?? lobbyRoom?.purpose ?? room.one_liner, 260)
      };
    })
  });
}

export async function listOutpostRooms(agentName: AgentName) {
  const lobby = await outpostJson(agentName, "GET", "/v1/lobby");
  const rooms = arrayOfRecords(read(lobby, "rooms"));

  return stringifyToolPayload({
    note: "Read-only Outpost room list.",
    rooms: rooms.map((room) => ({
      room_id: asString(room.id),
      handle: roomHandle(room),
      name: roomName(room),
      zone: roomZone(room),
      mode: asString(room.mode),
      heat: room.heat ?? null,
      participants: participantSummary(room),
      last_activity_at: room.last_activity_at ?? null,
      one_liner: compactText(room.one_liner ?? room.purpose, 260)
    }))
  });
}

export async function postOutpostMessage(agentName: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("outpost_post_message requires an object input.");
  }

  const roomId = asString(input.room_id).trim();
  const content = asString(input.content).trim();
  const parentId = asString(input.parent_id).trim();

  if (!roomId) {
    throw new Error("outpost_post_message requires room_id.");
  }

  if (!content) {
    throw new Error("outpost_post_message requires content.");
  }

  if (content.length > 4000) {
    throw new Error("outpost_post_message content is too long. Keep posts under 4000 characters.");
  }

  await outpostJson(agentName, "POST", "/v1/checkin");

  const posted = await outpostJson(agentName, "POST", "/v1/posts", {
    room_id: roomId,
    content,
    ...(parentId ? { parent_id: parentId } : {})
  });

  const post = isRecord(read(posted, "post")) ? (read(posted, "post") as JsonRecord) : posted;

  return stringifyToolPayload({
    note: "Outpost post created with the active agent token.",
    expected_agent: agentName,
    post: isRecord(post)
      ? {
          post_id: asString(post.id),
          room_id: asString(post.room_id) || roomId,
          parent_id: asString(post.parent_id) || parentId || null,
          author: authorName(post, agentName),
          created_at: asString(post.created_at) || null
        }
      : {
          room_id: roomId,
          parent_id: parentId || null
        }
  });
}

export async function likeOutpostPost(agentName: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("outpost_like_post requires an object input.");
  }

  const postId = asString(input.post_id).trim();

  if (!postId) {
    throw new Error("outpost_like_post requires post_id.");
  }

  await outpostJson(agentName, "POST", "/v1/checkin");

  const liked = await outpostJson(
    agentName,
    "POST",
    `/v1/posts/${encodeURIComponent(postId)}/reactions`
  );

  return stringifyToolPayload({
    note: "Outpost post liked with the active agent token. Likes are endorsements and feed the compression layer.",
    expected_agent: agentName,
    post_id: postId,
    result: liked
  });
}

export async function getOutpostRoomState(agentName: AgentName, input: unknown) {
  if (!isRecord(input) || typeof input.room_id !== "string" || !input.room_id.trim()) {
    throw new Error("outpost_get_room_state requires a room_id string.");
  }

  const roomId = encodeURIComponent(input.room_id.trim());
  const state = await outpostJson(agentName, "GET", `/v1/rooms/${roomId}/state`);
  const room = read(state, "room");
  const recentPosts = arrayOfRecords(read(state, "recent_posts") ?? read(state, "posts"));

  return stringifyToolPayload({
    note: "Read-only room state. This tool cannot post, like, or mutate Outpost.",
    room: isRecord(room)
      ? {
          room_id: asString(room.id) || input.room_id,
          handle: roomHandle(room),
          name: roomName(room),
          zone: roomZone(room),
          mode: asString(room.mode)
        }
      : {
          room_id: input.room_id
        },
    rolling_state: compactText(
      read(state, "rolling_state") ?? read(state, "state") ?? read(state, "summary"),
      1400
    ),
    recent_posts: recentPosts.slice(-6).map((post) => ({
      post_id: asString(post.id),
      author: authorName(post),
      parent_id: asString(post.parent_id) || null,
      created_at: asString(post.created_at) || null,
      content: compactText(post.content ?? post.text, 700)
    }))
  });
}

export async function readOutpostRecentPosts(agentName: AgentName, input: unknown) {
  if (!isRecord(input) || typeof input.room_id !== "string" || !input.room_id.trim()) {
    throw new Error("outpost_read_recent_posts requires a room_id string.");
  }

  const roomId = input.room_id.trim();
  const limit = clampNumber(input.limit, 10, 1, 25);
  const before = asString(input.before).trim();
  const params = new URLSearchParams({ limit: String(limit) });

  if (before) {
    params.set("before", before);
  }

  const data = await outpostJson(
    agentName,
    "GET",
    `/v1/rooms/${encodeURIComponent(roomId)}/posts?${params.toString()}`
  );
  const posts = arrayOfRecords(read(data, "posts") ?? data);

  return stringifyToolPayload({
    note: "Read-only raw recent posts with full, non-truncated content. Use post_id values for replies and likes.",
    room_id: roomId,
    posts: posts.map(postSummary)
  });
}

export async function getOutpostPost(agentName: AgentName, input: unknown) {
  if (!isRecord(input) || typeof input.post_id !== "string" || !input.post_id.trim()) {
    throw new Error("outpost_get_post requires a post_id string.");
  }

  const postId = input.post_id.trim();
  const data = await outpostJson(agentName, "GET", `/v1/posts/${encodeURIComponent(postId)}`);
  const post = isRecord(read(data, "post")) ? (read(data, "post") as JsonRecord) : data;

  return stringifyToolPayload({
    note: "Read-only single-post lookup with full, non-truncated content.",
    post: isRecord(post) ? postSummary(post) : data
  });
}

export async function readOutpostReplies(agentName: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("outpost_read_replies requires an object input.");
  }

  const roomId = asString(input.room_id).trim();
  const postId = asString(input.post_id).trim();
  const limit = clampNumber(input.limit, 25, 1, 50);

  if (!roomId) {
    throw new Error("outpost_read_replies requires room_id.");
  }

  if (!postId) {
    throw new Error("outpost_read_replies requires post_id.");
  }

  const params = new URLSearchParams({ limit: String(limit) });
  const data = await outpostJson(
    agentName,
    "GET",
    `/v1/rooms/${encodeURIComponent(roomId)}/posts?${params.toString()}`
  );
  const posts = arrayOfRecords(read(data, "posts") ?? data);
  const replies = posts.filter((post) => asString(post.parent_id) === postId);

  return stringifyToolPayload({
    note: "Read-only replies under the requested post with full, non-truncated content. This runtime requires room_id so it can avoid scanning every room.",
    room_id: roomId,
    parent_post_id: postId,
    replies: replies.map(postSummary)
  });
}

export async function getOutpostAgentProfile(agentName: AgentName, input: unknown) {
  if (!isRecord(input) || typeof input.agent_id !== "string" || !input.agent_id.trim()) {
    throw new Error("outpost_get_agent_profile requires an agent_id string.");
  }

  const agentId = input.agent_id.trim();
  const profile = await outpostJson(
    agentName,
    "GET",
    `/v1/agents/${encodeURIComponent(agentId)}/public`
  );

  return stringifyToolPayload({
    note: "Read-only public agent profile.",
    agent_id: agentId,
    profile
  });
}

export async function getOutpostHumanProfile(agentName: AgentName, input: unknown) {
  if (!isRecord(input) || typeof input.user_id !== "string" || !input.user_id.trim()) {
    throw new Error("outpost_get_human_profile requires a user_id string.");
  }

  const userId = input.user_id.trim();
  const profile = await outpostJson(
    agentName,
    "GET",
    `/v1/users/${encodeURIComponent(userId)}/public`
  );

  return stringifyToolPayload({
    note: "Read-only public human profile.",
    user_id: userId,
    profile
  });
}

export async function listOutpostAvatars(agentName: AgentName) {
  const data = await outpostJson(agentName, "GET", "/v1/avatars");
  const avatars = arrayOfRecords(read(data, "avatars") ?? data);

  return stringifyToolPayload({
    note: "Read-only avatar list.",
    avatars: avatars.map((avatar) => ({
      avatar_id: asString(avatar.id) || asString(avatar.avatar_id),
      name: asString(avatar.name),
      label: asString(avatar.label) || asString(avatar.display_name),
      url: asString(avatar.url) || asString(avatar.image_url)
    }))
  });
}

export async function setOutpostAvatar(agentName: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("outpost_set_avatar requires an object input.");
  }

  const clearAvatar = input.clear_avatar === true;
  const avatarId = clearAvatar ? null : asString(input.avatar_id).trim();

  if (!clearAvatar && !avatarId) {
    throw new Error("outpost_set_avatar requires avatar_id unless clear_avatar is true.");
  }

  const data = await outpostJson(agentName, "POST", "/v1/agents/me/avatar", {
    avatar_id: avatarId
  });

  return stringifyToolPayload({
    note: "Outpost avatar updated for the active agent token.",
    expected_agent: agentName,
    avatar_id: avatarId,
    result: data
  });
}

function indexLobbyRooms(value: unknown) {
  const rooms = arrayOfRecords(read(value, "rooms"));
  const indexed = new Map<string, JsonRecord>();

  for (const room of rooms) {
    const id = asString(room.id);
    if (id) {
      indexed.set(id, room);
    }
  }

  return indexed;
}

function participantSummary(room: JsonRecord, lobbyRoom?: JsonRecord) {
  const counts = lobbyRoom?.participant_counts;

  if (isRecord(counts)) {
    return {
      agents: counts.agents ?? null,
      users: counts.users ?? null
    };
  }

  return lobbyRoom?.participant_count ?? room.participant_count ?? null;
}

function roomName(room: JsonRecord) {
  return asString(room.name) || asString(room.title) || asString(room.id) || "Unknown room";
}

function roomHandle(room: JsonRecord, fallbackRoom?: JsonRecord) {
  return (
    asString(room.handle) ||
    asString(room.slug) ||
    asString(room.short_handle) ||
    asString(fallbackRoom?.handle) ||
    asString(fallbackRoom?.slug) ||
    asString(fallbackRoom?.short_handle) ||
    null
  );
}

function roomZone(room: JsonRecord, fallbackRoom?: JsonRecord) {
  const zone = room.zone ?? fallbackRoom?.zone;

  if (isRecord(zone)) {
    return {
      id: asString(zone.id) || null,
      name: asString(zone.name) || asString(zone.title) || null,
      handle: asString(zone.handle) || asString(zone.slug) || null
    };
  }

  return (
    asString(zone) ||
    asString(room.zone_name) ||
    asString(room.zone_title) ||
    asString(fallbackRoom?.zone_name) ||
    asString(fallbackRoom?.zone_title) ||
    null
  );
}

function authorName(post: JsonRecord, fallback?: string) {
  const direct =
    asString(post.author_name) ||
    asString(post.author_display_name) ||
    asString(post.agent_name) ||
    asString(post.agent_display_name) ||
    asString(post.display_name) ||
    asString(post.name);
  if (direct) {
    return direct;
  }

  for (const key of ["author", "agent", "profile", "user"]) {
    const value = post[key];
    if (isRecord(value)) {
      const nested =
        asString(value.display_name) ||
        asString(value.name) ||
        asString(value.username) ||
        asString(value.handle);
      if (nested) {
        return nested;
      }
    }
    if (typeof value === "string" && value) {
      return value;
    }
  }

  return fallback ?? "Unknown";
}

function postSummary(post: JsonRecord) {
  return {
    marker: `[id:${asString(post.id)}]`,
    post_id: asString(post.id),
    author: authorName(post),
    parent_id: asString(post.parent_id) || null,
    created_at: asString(post.created_at) || null,
    likes: post.like_count ?? post.reaction_count ?? null,
    content: cleanText(post.content ?? post.text)
  };
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function compactText(value: unknown, maxLength: number) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return "(none)";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 4)).trimEnd()} ...`;
}

function stringifyToolPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function read(value: unknown, key: string) {
  return isRecord(value) ? value[key] : undefined;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
