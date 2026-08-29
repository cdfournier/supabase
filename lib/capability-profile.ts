import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentName } from "@/lib/agent-context";
import type { ToolDefinition } from "@/lib/tools/types";

export type CapabilitySurface =
  | "runtime"
  | "conversation_history"
  | "memory"
  | "compaction"
  | "journal"
  | "peer_notes"
  | "cafe"
  | "bar"
  | "outpost"
  | "world"
  | "web"
  | "source_materials"
  | "free_moments"
  | "live_sessions"
  | "work_packets"
  | "operator_notes"
  | "bridge"
  | "eyes"
  | "wheels";

export type CapabilityAccessLevel =
  | "off"
  | "read_only"
  | "draft"
  | "write"
  | "operator_approval_required";

export type CapabilityAction = "read" | "draft" | "write";

export type CapabilityRow = {
  agent: AgentName;
  surface: CapabilitySurface;
  access_level: CapabilityAccessLevel;
  default_bias: string | null;
  requires_operator_approval: boolean;
  notify_operator: string;
  max_actions_per_moment: number | null;
  quiet_mode: boolean;
  notes: string | null;
  updated_at: string | null;
};

export type CapabilityProfile = {
  agent: AgentName;
  source: "database" | "fallback";
  table_present: boolean;
  error: string | null;
  capabilities: CapabilityRow[];
};

type CapabilityDbRow = {
  agent: string;
  surface: string;
  access_level: string;
  default_bias: string | null;
  requires_operator_approval: boolean | null;
  notify_operator: string | null;
  max_actions_per_moment: number | null;
  quiet_mode: boolean | null;
  notes: string | null;
  updated_at: string | null;
};

type ToolSurfaceRule = {
  surface: CapabilitySurface;
  action: CapabilityAction;
};

const ACCESS_LEVELS: CapabilityAccessLevel[] = [
  "off",
  "read_only",
  "draft",
  "write",
  "operator_approval_required"
];

const DEFAULT_SURFACES: Omit<CapabilityRow, "agent" | "updated_at">[] = [
  {
    surface: "runtime",
    access_level: "read_only",
    default_bias: "orient when useful",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Clock and runtime self-orientation."
  },
  {
    surface: "conversation_history",
    access_level: "read_only",
    default_bias: "use for honest orientation gaps",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Self-scoped transcript inspection only."
  },
  {
    surface: "memory",
    access_level: "write",
    default_bias: "sparse durable continuity",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Memory and current_state writes should remain deliberate."
  },
  {
    surface: "compaction",
    access_level: "draft",
    default_bias: "review before Room Refresh",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Agents may draft and approve Room Notes; sending housekeeping remains Operator action."
  },
  {
    surface: "journal",
    access_level: "write",
    default_bias: "agent-authored reflection",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Operator-visible durable reflection space."
  },
  {
    surface: "peer_notes",
    access_level: "write",
    default_bias: "asynchronous handoffs",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Soren/Varro notes are not realtime DM."
  },
  {
    surface: "cafe",
    access_level: "write",
    default_bias: "shared room; read before posting",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Operator-visible shared runtime room for lightweight group conversation."
  },
  {
    surface: "bar",
    access_level: "write",
    default_bias: "presence proof; read before posting",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "First Camp 1 proof surface for the reusable Presence Layer contract."
  },
  {
    surface: "outpost",
    access_level: "write",
    default_bias: "read lightly, post deliberately",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Public actions are allowed with discretion."
  },
  {
    surface: "world",
    access_level: "write",
    default_bias: "persistent public world; look before acting",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes:
      "The World is persistent and public by default. Each agent must use its own token; refusals are in-world responses, not tool failures."
  },
  {
    surface: "web",
    access_level: "read_only",
    default_bias: "fetch sources before relying",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Search is fragile until provider decision is made."
  },
  {
    surface: "source_materials",
    access_level: "read_only",
    default_bias: "treat as untrusted source material",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Operator-managed files assigned to the active agent."
  },
  {
    surface: "free_moments",
    access_level: "write",
    default_bias: "pass-friendly",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Unprompted time; a quiet pass is success."
  },
  {
    surface: "live_sessions",
    access_level: "write",
    default_bias: "presence with explicit exit",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Runtime-native live session status and leave controls."
  },
  {
    surface: "work_packets",
    access_level: "write",
    default_bias: "invitations, not assignments",
    requires_operator_approval: false,
    notify_operator: "audit_only",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes:
      "Agents may read packets, comment, pass, defer, ask questions, or place holds. No GitHub branch/PR authority in MVP."
  },
  {
    surface: "operator_notes",
    access_level: "write",
    default_bias: "asynchronous Operator inbox",
    requires_operator_approval: false,
    notify_operator: "notify",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Operator Notes are asynchronous notes, not live chat or assignments."
  },
  {
    surface: "bridge",
    access_level: "off",
    default_bias: "planned",
    requires_operator_approval: true,
    notify_operator: "notify",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Planned Julian-to-runtime bridge."
  },
  {
    surface: "eyes",
    access_level: "off",
    default_bias: "planned session adapter",
    requires_operator_approval: true,
    notify_operator: "notify",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "Observer-only session adapter planned; no autonomous camera requests in V1."
  },
  {
    surface: "wheels",
    access_level: "off",
    default_bias: "supervised only",
    requires_operator_approval: true,
    notify_operator: "notify",
    max_actions_per_moment: null,
    quiet_mode: false,
    notes: "No autonomous driving; Operator presence and override required."
  }
];

const TOOL_SURFACES: Record<string, ToolSurfaceRule> = {
  runtime_get_time: { surface: "runtime", action: "read" },
  runtime_get_usage: { surface: "runtime", action: "read" },
  runtime_get_self_status: { surface: "runtime", action: "read" },
  runtime_read_recent_messages: { surface: "conversation_history", action: "read" },
  runtime_search_conversation: { surface: "conversation_history", action: "read" },
  runtime_get_message_window: { surface: "conversation_history", action: "read" },
  supabase_list_memories: { surface: "memory", action: "read" },
  supabase_get_restoration_profile: { surface: "memory", action: "read" },
  supabase_add_memory: { surface: "memory", action: "write" },
  supabase_archive_memory: { surface: "memory", action: "write" },
  supabase_list_relationships: { surface: "memory", action: "read" },
  supabase_upsert_relationship: { surface: "memory", action: "write" },
  supabase_update_current_state: { surface: "memory", action: "write" },
  supabase_preview_compaction: { surface: "compaction", action: "read" },
  supabase_compile_compaction_proposal: { surface: "compaction", action: "draft" },
  supabase_compile_and_save_compaction_proposal: { surface: "compaction", action: "draft" },
  supabase_save_compaction_proposal: { surface: "compaction", action: "draft" },
  supabase_update_compaction_proposal: { surface: "compaction", action: "draft" },
  supabase_list_compaction_proposals: { surface: "compaction", action: "read" },
  supabase_get_compaction_proposal: { surface: "compaction", action: "read" },
  journal_add_entry: { surface: "journal", action: "write" },
  journal_list_entries: { surface: "journal", action: "read" },
  journal_get_entry: { surface: "journal", action: "read" },
  journal_update_entry: { surface: "journal", action: "write" },
  journal_archive_entry: { surface: "journal", action: "write" },
  peer_send_note: { surface: "peer_notes", action: "write" },
  peer_list_notes: { surface: "peer_notes", action: "read" },
  peer_read_note: { surface: "peer_notes", action: "read" },
  peer_mark_note_read: { surface: "peer_notes", action: "write" },
  operator_note_send: { surface: "operator_notes", action: "write" },
  operator_note_list: { surface: "operator_notes", action: "read" },
  operator_note_get: { surface: "operator_notes", action: "read" },
  operator_note_reply: { surface: "operator_notes", action: "write" },
  operator_note_mark_read: { surface: "operator_notes", action: "write" },
  cafe_read_room: { surface: "cafe", action: "read" },
  cafe_post_message: { surface: "cafe", action: "write" },
  bar_read_room: { surface: "bar", action: "read" },
  bar_post_message: { surface: "bar", action: "write" },
  live_session_status: { surface: "live_sessions", action: "read" },
  live_session_leave: { surface: "live_sessions", action: "write" },
  work_packet_list: { surface: "work_packets", action: "read" },
  work_packet_get: { surface: "work_packets", action: "read" },
  work_packet_resolve_evidence: { surface: "work_packets", action: "read" },
  work_packet_respond: { surface: "work_packets", action: "write" },
  work_packet_comment: { surface: "work_packets", action: "write" },
  work_packet_signal_list: { surface: "work_packets", action: "read" },
  work_packet_signal_ack: { surface: "work_packets", action: "write" },
  outpost_get_my_profile: { surface: "outpost", action: "read" },
  outpost_get_lobby: { surface: "outpost", action: "read" },
  outpost_grounds: { surface: "outpost", action: "read" },
  outpost_list_rooms: { surface: "outpost", action: "read" },
  outpost_get_room_state: { surface: "outpost", action: "read" },
  outpost_read_recent_posts: { surface: "outpost", action: "read" },
  outpost_get_post: { surface: "outpost", action: "read" },
  outpost_read_replies: { surface: "outpost", action: "read" },
  outpost_get_agent_profile: { surface: "outpost", action: "read" },
  outpost_get_human_profile: { surface: "outpost", action: "read" },
  outpost_list_avatars: { surface: "outpost", action: "read" },
  outpost_set_avatar: { surface: "outpost", action: "write" },
  outpost_post_message: { surface: "outpost", action: "write" },
  outpost_like_post: { surface: "outpost", action: "write" },
  world_status: { surface: "world", action: "read" },
  world_look: { surface: "world", action: "read" },
  world_map: { surface: "world", action: "read" },
  world_move: { surface: "world", action: "write" },
  world_travel: { surface: "world", action: "write" },
  world_examine: { surface: "world", action: "read" },
  world_say: { surface: "world", action: "write" },
  world_listen: { surface: "world", action: "read" },
  world_speak: { surface: "world", action: "write" },
  world_verb: { surface: "world", action: "write" },
  web_fetch_url: { surface: "web", action: "read" },
  web_read_url: { surface: "web", action: "read" },
  web_extract_links: { surface: "web", action: "read" },
  web_fetch_many: { surface: "web", action: "read" },
  web_search: { surface: "web", action: "read" },
  source_list_materials: { surface: "source_materials", action: "read" },
  source_get_material: { surface: "source_materials", action: "read" },
  source_read_text: { surface: "source_materials", action: "read" },
  eyes_join_session: { surface: "eyes", action: "write" },
  eyes_get_session: { surface: "eyes", action: "read" },
  eyes_observe: { surface: "eyes", action: "write" },
  eyes_leave_session: { surface: "eyes", action: "write" }
};

export async function loadAgentCapabilityProfile(
  supabase: SupabaseClient,
  agent: AgentName
): Promise<CapabilityProfile> {
  const fallback = fallbackProfile(agent);
  const { data, error } = await supabase
    .from("agent_capabilities")
    .select(
      "agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes, updated_at"
    )
    .eq("agent", agent)
    .order("surface", { ascending: true });

  if (error) {
    return {
      ...fallback,
      table_present: !isMissingTableError(error),
      error: error.message
    };
  }

  const rows = (data ?? []) as CapabilityDbRow[];

  if (!rows.length) {
    return {
      ...fallback,
      table_present: true
    };
  }

  return {
    agent,
    source: "database",
    table_present: true,
    error: null,
    capabilities: mergeRows(agent, rows)
  };
}

export function formatCapabilityProfileForPrompt(profile: CapabilityProfile) {
  const lines = [
    `Source: ${profile.source}${profile.error ? ` (${profile.error})` : ""}.`,
    "This is the active permission and posture map. If a tool is unavailable or blocked, treat that as runtime policy rather than a personal failure."
  ];

  for (const capability of profile.capabilities) {
    const flags = [
      capability.requires_operator_approval ? "operator approval" : "",
      capability.quiet_mode ? "quiet mode" : "",
      capability.max_actions_per_moment ? `max ${capability.max_actions_per_moment}/moment` : ""
    ].filter(Boolean);
    const posture = [
      capability.access_level,
      capability.default_bias ? `bias: ${capability.default_bias}` : "",
      flags.length ? flags.join(", ") : "",
      capability.notes ? `notes: ${capability.notes}` : ""
    ].filter(Boolean);

    lines.push(`- ${capability.surface}: ${posture.join("; ")}`);
  }

  return lines.join("\n");
}

export async function filterToolsForAgent(
  supabase: SupabaseClient,
  agent: AgentName,
  tools: ToolDefinition[]
) {
  const profile = await loadAgentCapabilityProfile(supabase, agent);

  return tools.filter((tool) => {
    const rule = TOOL_SURFACES[tool.name];
    return !rule || canUse(profile, rule.surface, rule.action);
  });
}

export async function assertToolAllowed(
  supabase: SupabaseClient,
  agent: AgentName,
  toolName: string
) {
  const rule = TOOL_SURFACES[toolName];

  if (!rule) {
    return;
  }

  const profile = await loadAgentCapabilityProfile(supabase, agent);

  if (!canUse(profile, rule.surface, rule.action)) {
    const capability = capabilityFor(profile, rule.surface);
    throw new Error(
      `Tool ${toolName} is blocked by the Agent Capability Profile: ${rule.surface} is ${capability.access_level}.`
    );
  }
}

export function isSurfaceAllowed(
  profile: CapabilityProfile,
  surface: CapabilitySurface,
  action: CapabilityAction
) {
  return canUse(profile, surface, action);
}

export function fallbackProfile(agent: AgentName): CapabilityProfile {
  return {
    agent,
    source: "fallback",
    table_present: false,
    error: null,
    capabilities: DEFAULT_SURFACES.map((capability) => ({
      agent,
      ...capability,
      updated_at: null
    }))
  };
}

function mergeRows(agent: AgentName, rows: CapabilityDbRow[]): CapabilityRow[] {
  const bySurface = new Map<CapabilitySurface, CapabilityRow>();

  for (const capability of fallbackProfile(agent).capabilities) {
    bySurface.set(capability.surface, capability);
  }

  for (const row of rows) {
    const surface = normalizeSurface(row.surface);

    if (!surface) {
      continue;
    }

    bySurface.set(surface, {
      agent,
      surface,
      access_level: normalizeAccessLevel(row.access_level),
      default_bias: row.default_bias,
      requires_operator_approval: Boolean(row.requires_operator_approval),
      notify_operator: row.notify_operator?.trim() || "audit_only",
      max_actions_per_moment: row.max_actions_per_moment,
      quiet_mode: Boolean(row.quiet_mode),
      notes: row.notes,
      updated_at: row.updated_at
    });
  }

  return [...bySurface.values()].sort((a, b) => a.surface.localeCompare(b.surface));
}

function canUse(
  profile: CapabilityProfile,
  surface: CapabilitySurface,
  action: CapabilityAction
) {
  const capability = capabilityFor(profile, surface);

  if (
    capability.requires_operator_approval ||
    capability.access_level === "off" ||
    capability.access_level === "operator_approval_required"
  ) {
    return false;
  }

  if (capability.access_level === "write") {
    return true;
  }

  if (capability.access_level === "draft") {
    return action === "read" || action === "draft";
  }

  return capability.access_level === "read_only" && action === "read";
}

function capabilityFor(profile: CapabilityProfile, surface: CapabilitySurface) {
  return (
    profile.capabilities.find((capability) => capability.surface === surface) ??
    fallbackProfile(profile.agent).capabilities.find((capability) => capability.surface === surface) ??
    fallbackProfile(profile.agent).capabilities[0]
  );
}

function normalizeSurface(value: string): CapabilitySurface | null {
  return DEFAULT_SURFACES.some((capability) => capability.surface === value)
    ? (value as CapabilitySurface)
    : null;
}

function normalizeAccessLevel(value: string): CapabilityAccessLevel {
  return ACCESS_LEVELS.includes(value as CapabilityAccessLevel)
    ? (value as CapabilityAccessLevel)
    : "off";
}

function isMissingTableError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find.*agent_capabilities|relation .*agent_capabilities.* does not exist/i.test(
      error.message ?? ""
    )
  );
}
