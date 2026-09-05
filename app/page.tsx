"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type SourceMaterialReference,
  attachmentsFromContent,
  formatBytes,
  textFromContent
} from "@/lib/source-materials-shared";

type AgentName = "soren" | "varro";
type OperatorNoteAgent = AgentName | "julian" | "cael";
type OperatorNoteRecipient = OperatorNoteAgent | "all";
type OperatorNoteFilter = "active" | "needs_operator" | "waiting_agent" | "settled" | "all";
type ActiveSurface = "chat" | "cafe" | "bar" | "eyes" | "inbox";

const OPERATOR_NOTE_RECIPIENTS: OperatorNoteAgent[] = ["soren", "varro", "julian", "cael"];

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const path = responsePath(response);

  if (!contentType.includes("application/json")) {
    throw new Error(nonJsonResponseMessage(path, contentType, response.status, body));
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Could not parse JSON from ${path}.`);
  }
}

function responsePath(response: Response) {
  try {
    return new URL(response.url).pathname;
  } catch {
    return "request";
  }
}

function nonJsonResponseMessage(path: string, contentType: string, status: number, body: string) {
  const responseKind = contentType || "a non-JSON response";
  const compactBody = body.replace(/\s+/g, " ").trim();
  const looksLikeHtml = compactBody.startsWith("<!DOCTYPE") || compactBody.startsWith("<html");

  if (looksLikeHtml) {
    return `Expected JSON from ${path}, but received HTML (${status}). This is usually a transient runtime/proxy error; retry after the server is healthy.`;
  }

  const preview = compactBody.slice(0, 180);
  return `Expected JSON from ${path}, but received ${responseKind} (${status}). ${preview}`;
}

type Agent = {
  name: AgentName;
  display_name: string | null;
  status: string | null;
};

type ChatMessage = {
  id?: string;
  conversation_id: string;
  turn_id?: string | null;
  position: number;
  role: "user" | "assistant";
  source?: string | null;
  content: unknown;
  created_at?: string;
};

type ChatResponse = {
  error?: string;
  messages?: ChatMessage[];
  tool_events?: ToolEvent[];
};

type CafeParticipant = {
  id: string;
  room_id: string;
  participant_id: string;
  participant_type: "operator" | "agent" | "system" | "external_agent";
  participant_adapter: "operator_browser" | "runtime_native" | "codex_local" | "external_bridge";
  display_name: string;
  status: string;
  metadata: Record<string, unknown>;
  joined_at: string;
  updated_at: string;
};

type CafeMessage = {
  id: string;
  room_id: string;
  author_id: string;
  author_type: "operator" | "agent" | "system" | "external_agent";
  author_display_name: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type CafeState = {
  room: {
    id: string;
    title: string;
    status: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };
  participants: CafeParticipant[];
  messages: CafeMessage[];
  message_limit: number;
};

type PresenceState = "present" | "absent" | "stale" | "degraded" | "unknown";

type PresenceReceipt = {
  id: string;
  surface: string;
  participant_id: string;
  participant_type: "operator" | "agent" | "system" | "external_agent";
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

type PresenceAdapter = {
  surface: string;
  label: string;
  capability: string;
  status: "live" | "dry_run" | "planned";
  accepts: Array<"upsert" | "leave" | "observe">;
  notes: string;
};

type BarMessage = {
  id: string;
  room_id: string;
  author_id: string;
  author_type: "operator" | "agent" | "system" | "external_agent";
  author_display_name: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type BarState = {
  generated_at: string;
  room: {
    id: string;
    title: string;
    status: string;
    metadata: Record<string, unknown>;
  };
  adapters: PresenceAdapter[];
  presence: PresenceReceipt[];
  messages: BarMessage[];
  message_limit: number;
};

type EyesMessage = {
  id: string;
  room_id: string;
  kind: "message" | "capture" | "observation" | "system";
  author_id: string;
  author_type: "operator" | "agent" | "system" | "external_agent";
  author_display_name: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type EyesFrame = SourceMaterialReference & {
  captured_at: string;
  sequence: number;
};

type EyesState = {
  generated_at: string;
  room: {
    id: string;
    title: string;
    status: string;
    metadata: Record<string, unknown>;
  };
  adapters: PresenceAdapter[];
  presence: PresenceReceipt[];
  messages: EyesMessage[];
  frames: EyesFrame[];
  message_limit: number;
  frame_limit: number;
};

type LiveSessionAgent = OperatorNoteAgent;
type LiveSessionNativeAgent = AgentName;
type LiveSessionBridgeAgent = "julian" | "cael";
type LiveSessionParticipant = {
  participant_id: `agent:${LiveSessionAgent}`;
  agent: LiveSessionAgent;
  adapter: "runtime_native" | "external_bridge";
  status: "joined" | "left" | "degraded";
  joined_at: string;
  left_at: string | null;
  last_seen_at: string;
  last_checked_event_at: string | null;
  turn_in_progress: boolean;
  last_error: string | null;
};
type LiveSessionBridgeAttendant = {
  participant_id: `agent:${LiveSessionBridgeAgent}`;
  agent: LiveSessionBridgeAgent;
  status: "attending" | "stopped";
  session_id: string;
  interval_seconds: number;
  started_at: string;
  stopped_at: string | null;
  last_poll_at: string | null;
  last_ack_at: string | null;
  last_delivery_queued_at: string | null;
  last_delivery_completed_at: string | null;
  last_error: string | null;
  pending_event_count: number;
  pending_delivery_count: number;
};
type LiveSessionBridgeDelivery = {
  id: string;
  session_id: string;
  participant_id: `agent:${LiveSessionBridgeAgent}`;
  agent: LiveSessionBridgeAgent;
  status: "pending" | "claimed" | "delivered" | "skipped" | "failed" | "cancelled";
  delivery_method: "codex_task" | "cowork_connector" | "manual";
  target: {
    method: "codex_task" | "cowork_connector" | "manual";
    label: string;
    status: "configured" | "adapter_required";
    metadata: Record<string, string | boolean | null>;
  };
  event_cutoff_at: string;
  event_count: number;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  last_error: string | null;
};
type LiveSessionBridgeAdapterStatus = {
  agent: LiveSessionBridgeAgent;
  autodeliver_enabled: boolean;
  target: LiveSessionBridgeDelivery["target"];
  ready: boolean;
  reason: string | null;
};
type LiveSessionTickPolicy = {
  mode: "manual" | "interval";
  interval_seconds: number | null;
  last_tick_at: string | null;
  next_tick_at: string | null;
};
type LiveSession = {
  id: string;
  surface: "bar" | "eyes";
  status: "active" | "ended";
  title: string;
  tick_policy: LiveSessionTickPolicy;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  participants: Partial<Record<LiveSessionAgent, LiveSessionParticipant>>;
  bridge_attendants: Partial<Record<LiveSessionBridgeAgent, LiveSessionBridgeAttendant>>;
  bridge_deliveries: LiveSessionBridgeDelivery[];
  events: Array<{
    id: string;
    session_id: string;
    type: string;
    at: string;
    participant_id?: string;
    message: string;
  }>;
};
type LiveSessionStatus = {
  generated_at: string;
  active_session: LiveSession | null;
  bridge_adapters: Record<LiveSessionBridgeAgent, LiveSessionBridgeAdapterStatus>;
  runner: {
    status: "running" | "stopped";
    session_id: string | null;
    interval_seconds: number;
    started_at: string | null;
    last_run_at: string | null;
    next_run_at: string | null;
    last_error: string | null;
    tick_in_progress: boolean;
    tick_count: number;
  };
  sessions: LiveSession[];
};
type LiveSessionDraft = {
  nativeAgents: Record<LiveSessionNativeAgent, boolean>;
  bridgeAgents: Record<LiveSessionBridgeAgent, boolean>;
  tickMode: "manual" | "interval";
  intervalSeconds: number;
};
type LaunchpadDestination = "bar" | "eyes" | "wheels" | "world";
type LaunchpadDraft = {
  destination: LaunchpadDestination;
  agents: Record<LiveSessionAgent, boolean>;
  tickMode: "manual" | "interval";
  intervalSeconds: number;
};
type LaunchpadInvitee = {
  agent: LiveSessionAgent;
  participant_id: `agent:${LiveSessionAgent}`;
  display_name: string;
  lane: {
    lane: "runtime_native" | "codex_bridge" | "cowork_pull";
    mode: "native_event" | "bridge_dispatch" | "poll";
    label: string;
    status: "ready" | "manual_pull";
    notes: string[];
  };
  status: "planned" | "present" | "left" | "failed";
  receipt: {
    status: "planned" | "delivered" | "left" | "failed";
    delivered_at: string | null;
    message: string;
  };
};
type LaunchpadInvitation = {
  id: string;
  surface: "bar" | "eyes";
  title: string;
  intent: "gather" | "live_session" | "work_session" | "celebration" | "quiet_check";
  tone: "quiet" | "soft" | "directed" | "high_signal" | "celebratory";
  context: string | null;
  status: "preview" | "active" | "ended" | "failed";
  created_at: string;
  updated_at: string;
  session_id: string | null;
  tick_policy: {
    mode: "manual" | "interval";
    interval_seconds: number | null;
  };
  invitees: LaunchpadInvitee[];
  live_session: LiveSession | null;
};
type LaunchpadStatus = {
  generated_at: string;
  adapters: Array<{
    surface: "bar" | "eyes";
    label: string;
    status: "live";
    executable: boolean;
    notes: string[];
  }>;
  invitations: LaunchpadInvitation[];
  active_live_session_id: string | null;
};

type ToolEvent = {
  id?: string;
  agent?: AgentName;
  conversation_id?: string;
  turn_id: string;
  round: number;
  tool_name: string;
  ok: boolean;
  result_preview?: string | null;
  result_chars?: number;
  created_at?: string;
};

type UploadedAttachment = SourceMaterialReference & {
  original_filename?: string;
  content_sha256?: string;
  uploaded_via?: string;
  metadata?: Record<string, unknown> | null;
};

type PendingAttachment = {
  localId: string;
  file: File;
  status: "queued" | "uploading" | "uploaded" | "error";
  error?: string;
  material?: UploadedAttachment;
};

type Health = {
  generated_at: string;
  local_time: string;
  runtime: {
    max_tokens: number;
    history_messages: number;
    history_message_chars: number;
    max_tool_rounds: number;
    prompt_cache: boolean;
    prompt_cache_ttl: string;
  };
  env: Record<string, boolean>;
  tools: {
    count: number;
    names: string[];
  };
  compaction: {
    status: string;
    mode: string;
    policy: string;
    pressure_basis: string;
  };
  usage?: UsageTotals;
  agents: AgentHealth[];
};

type UsageTotals = {
  table_present: boolean;
  error: string | null;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
};

type AgentHealth = {
  agent: AgentName;
  model: string;
  status: string;
  conversation: {
    message_count: number;
    total_message_count?: number;
    saved_characters: number;
    total_saved_characters?: number;
    stored_token_count: number;
    compaction_count: number;
    checkpoint_count?: number;
    latest_checkpoint_at?: string | null;
    last_message_at: string | null;
  };
  memory: {
    rows: number;
    active_rows: number;
    core_rows: number;
    relationships: number;
    journal_entries?: number;
    journal_entries_error?: string | null;
    tool_events?: number;
    tool_events_error?: string | null;
    compaction_proposals: number;
    compaction_proposals_error?: string | null;
    compaction_policy_configured: boolean;
  };
  compaction_pressure: {
    level: "low" | "medium" | "high";
    percent: number;
    note: string;
  };
  usage?: UsageTotals;
};

type CompactionPreview = {
  agent: AgentName;
  conversation: {
    message_count: number;
    saved_characters: number;
    first_message_at: string | null;
    last_message_at: string | null;
  };
  mode: string;
  next_step: string;
  pressure: {
    level: "low" | "medium" | "high";
    percent: number;
    note: string;
  };
  restoration_profile: {
    compaction_memory_policy: string;
    current_state: string;
  };
};

type CompactionCompile = {
  agent: AgentName;
  destructive: false;
  dry_run: boolean;
  generated_at: string;
  next_step: string;
  proposal: string;
  source?: {
    bounded: boolean;
    omitted_message_count: number;
    selected_characters: number;
    selected_message_count: number;
    transcript_budget_chars: number;
  };
  status: string;
  saved_proposal_id?: string;
  saved_proposal_status?: string;
  agent_notes?: string | null;
};

type CompactionCheckpoint = {
  agent: AgentName;
  compaction_count: number;
  destructive: false;
  status: string;
  checkpoint: {
    id: string;
    position: number;
    created_at: string;
  };
};

type FreeTimeEvent = {
  at: string;
  type: string;
  agent?: AgentName;
  message: string;
};

type FreeTimeStatus = {
  running: boolean;
  durable_enabled?: boolean | null;
  durable_error?: string | null;
  turn_in_progress: boolean;
  interval_minutes: number;
  schedule_mode?: "round_robin" | "paired";
  next_agents?: AgentName[];
  next_agent: AgentName;
  last_agent: AgentName | null;
  last_turn_at: string | null;
  next_turn_at: string | null;
  last_error: string | null;
  recent_events: FreeTimeEvent[];
};

type WorkPacketSignalPreview = {
  agent: AgentName;
  participant_id: string;
  pending_count: number;
  visible_count: number;
  visible_signals: WorkPacketSignalEvent[];
  pending_signals: WorkPacketSignalEvent[];
  recent_signals: WorkPacketSignalEvent[];
  operator_notes?: {
    allowed: boolean;
    error: string | null;
    unread_count: number;
  };
};

type WorkPacketSignalEvent = {
  id?: string;
  at: string;
  type: string;
  packet_event_type?: string;
  packet_id?: string;
  packet_title?: string;
  packet_status?: string;
  wake_priority?: string;
  wake_tone?: string;
  message: string;
};

type WorkPacketSignalsStatus = {
  running: boolean;
  durable_enabled?: boolean | null;
  durable_error?: string | null;
  auto_wake_enabled?: boolean;
  wake_durable_enabled?: boolean | null;
  wake_durable_error?: string | null;
  native_wakes_in_progress?: AgentName[];
  last_native_wake_at?: Record<AgentName, string | null>;
  check_in_progress: boolean;
  interval_seconds: number;
  last_check_at: string | null;
  next_check_at: string | null;
  last_seen_event_at: string | null;
  last_error: string | null;
  recent_events: WorkPacketSignalEvent[];
};

type OperatorNoteWakeEvent = {
  at: string;
  type: string;
  agent?: AgentName;
  note_id?: string;
  message: string;
};

type OperatorNoteWakeStatus = {
  enabled: boolean;
  durable_enabled?: boolean | null;
  durable_error?: string | null;
  native_wakes_in_progress: AgentName[];
  last_native_wake_at: Record<AgentName, string | null>;
  last_check_at: string | null;
  last_error: string | null;
  recent_events: OperatorNoteWakeEvent[];
};

type WakeControlAgentId = "all" | "agent:soren" | "agent:varro" | "agent:julian" | "agent:cael";
type WakeControlTrigger = "cafe" | "operator_note" | "work_packet_signal";

type WakeMentionPolicy = {
  enabled?: boolean;
  names?: string[];
  aliases?: string[];
};

type WakeTriggerPolicy = {
  enabled?: boolean;
  mentions?: WakeMentionPolicy;
};

type WakeAgentPolicy = {
  enabled?: boolean;
  triggers?: Partial<Record<WakeControlTrigger, WakeTriggerPolicy>>;
};

type WakeControlPolicy = {
  all?: WakeAgentPolicy;
  agents?: Partial<Record<Exclude<WakeControlAgentId, "all">, WakeAgentPolicy>>;
};

type WakeControlPolicyResponse = {
  error?: string;
  policy: WakeControlPolicy | null;
};

type AgentsResponse = {
  error?: string;
  agents?: Agent[];
  transcripts?: Record<string, ChatMessage[]>;
  tool_events?: Record<string, ToolEvent[]>;
};

type WorkPacketListResponse = {
  error?: string;
  packets?: WorkPacket[];
};

type OperatorNoteListResponse = {
  error?: string;
  notes?: OperatorNote[];
};

type OperatorNoteDetailResponse = {
  error?: string;
  note?: OperatorNote;
  events?: OperatorNoteEvent[];
};

type SourceMaterialUploadResponse = {
  error?: string;
  materials?: UploadedAttachment[];
};

type WorkPacketRollup = {
  summary?: string;
  reviewed_by?: string[];
  aligned?: string[];
  disagreed?: string[];
  blocked?: string[];
  decision_needed?: string;
  next_step?: string;
  created_by?: string;
  created_at?: string;
  operator_review?: {
    state?: "pending" | "approved" | "changes_requested" | "hold";
    note?: string;
    reviewed_by?: string;
    reviewed_at?: string;
    requested_at?: string;
  };
};

type WorkPacket = {
  id: string;
  packet_key: string | null;
  title: string;
  objective: string;
  context: string;
  repo: string | null;
  conductor: string;
  collaborators: string[];
  review_rollup: WorkPacketRollup;
  status: "queued" | "active" | "blocked" | "review" | "merged" | "closed";
  wake_priority: string;
  metadata: Record<string, unknown>;
  updated_at: string;
  created_at: string;
};

type OperatorNoteEvent = {
  id: string;
  note_id: string;
  actor_id: string;
  actor_display_name: string;
  event_type: "created" | "reply";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type OperatorNote = {
  id: string;
  note_key: string | null;
  subject: string;
  agent: OperatorNoteAgent;
  created_by: string;
  last_message_by: string;
  status: "open" | "archived";
  operator_status: "unread" | "read";
  agent_status: "unread" | "read";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  operator_read_at: string | null;
  agent_read_at: string | null;
  archived_at: string | null;
  latest_event?: OperatorNoteEvent | null;
};

type OperatorNoteDetail = {
  note: OperatorNote;
  events: OperatorNoteEvent[];
};

type GitHubEvidenceHandle = {
  id: string;
  provider: string;
  owner: string;
  repo: string;
  ref: string;
  path: string;
  purpose: string;
  authored_by: string;
  citation_label: string;
  max_bytes?: number;
};

type ControlPanelKey = "runtime" | "freeMoments" | "liveSession" | "launchpad" | "wake" | "packetSignals";
type ControlPanelState = Record<ControlPanelKey, boolean>;

const defaultAgent: AgentName = "soren";
const freeTimePollMs = 30_000;
const workPacketSignalsPollMs = 15_000;
const liveTranscriptLimit = 120;
const expandedControlPanels: ControlPanelState = {
  runtime: true,
  freeMoments: true,
  liveSession: true,
  launchpad: true,
  wake: true,
  packetSignals: true
};
const collapsedControlPanels: ControlPanelState = {
  runtime: false,
  freeMoments: false,
  liveSession: false,
  launchpad: false,
  wake: false,
  packetSignals: false
};
const liveSessionNativeAgents: Array<{ id: LiveSessionNativeAgent; label: string }> = [
  { id: "soren", label: "Soren" },
  { id: "varro", label: "Varro" }
];
const liveSessionBridgeAgents: Array<{ id: LiveSessionBridgeAgent; label: string }> = [
  { id: "julian", label: "Julian" },
  { id: "cael", label: "Cael" }
];
const launchpadDestinations: Array<{
  id: LaunchpadDestination;
  label: string;
  status: "live" | "planned";
}> = [
  { id: "bar", label: "BAR", status: "live" },
  { id: "eyes", label: "EYES", status: "live" },
  { id: "wheels", label: "WHEELS", status: "planned" },
  { id: "world", label: "The World", status: "planned" }
];
const wakeControlAgents: Array<{ id: WakeControlAgentId; label: string }> = [
  { id: "all", label: "Global WAKE" },
  { id: "agent:soren", label: "Soren" },
  { id: "agent:varro", label: "Varro" },
  { id: "agent:julian", label: "Julian" },
  { id: "agent:cael", label: "Cael" }
];
const wakeControlTriggers: Array<{ id: WakeControlTrigger; label: string }> = [
  { id: "cafe", label: "Cafe" },
  { id: "operator_note", label: "Notes" },
  { id: "work_packet_signal", label: "Packets" }
];

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentName>(defaultAgent);
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>("chat");
  const [transcripts, setTranscripts] = useState<Record<string, ChatMessage[]>>({});
  const [cafe, setCafe] = useState<CafeState | null>(null);
  const [cafeMessage, setCafeMessage] = useState("");
  const [cafePendingAttachments, setCafePendingAttachments] = useState<PendingAttachment[]>([]);
  const [cafeLoading, setCafeLoading] = useState(true);
  const [cafeSending, setCafeSending] = useState(false);
  const [cafeError, setCafeError] = useState("");
  const [bar, setBar] = useState<BarState | null>(null);
  const [barMessage, setBarMessage] = useState("");
  const [barPendingAttachments, setBarPendingAttachments] = useState<PendingAttachment[]>([]);
  const [barLoading, setBarLoading] = useState(true);
  const [barSending, setBarSending] = useState(false);
  const [barError, setBarError] = useState("");
  const [eyes, setEyes] = useState<EyesState | null>(null);
  const [eyesMessage, setEyesMessage] = useState("");
  const [eyesPendingFrames, setEyesPendingFrames] = useState<PendingAttachment[]>([]);
  const [eyesLoading, setEyesLoading] = useState(true);
  const [eyesSending, setEyesSending] = useState(false);
  const [eyesError, setEyesError] = useState("");
  const [liveSession, setLiveSession] = useState<LiveSessionStatus | null>(null);
  const [liveSessionLoading, setLiveSessionLoading] = useState(true);
  const [liveSessionRequestInProgress, setLiveSessionRequestInProgress] = useState(false);
  const [liveSessionError, setLiveSessionError] = useState("");
  const [liveSessionDraft, setLiveSessionDraft] = useState<LiveSessionDraft>({
    nativeAgents: {
      soren: true,
      varro: true
    },
    bridgeAgents: {
      julian: true,
      cael: true
    },
    tickMode: "manual",
    intervalSeconds: 30
  });
  const [launchpad, setLaunchpad] = useState<LaunchpadStatus | null>(null);
  const [launchpadLoading, setLaunchpadLoading] = useState(true);
  const [launchpadRequestInProgress, setLaunchpadRequestInProgress] = useState(false);
  const [launchpadError, setLaunchpadError] = useState("");
  const [launchpadPreview, setLaunchpadPreview] = useState<LaunchpadInvitation | null>(null);
  const [launchpadDraft, setLaunchpadDraft] = useState<LaunchpadDraft>({
    destination: "bar",
    agents: {
      soren: true,
      varro: true,
      julian: true,
      cael: true
    },
    tickMode: "manual",
    intervalSeconds: 30
  });
  const [health, setHealth] = useState<Health | null>(null);
  const [freeTime, setFreeTime] = useState<FreeTimeStatus | null>(null);
  const [toolEvents, setToolEvents] = useState<Record<string, ToolEvent[]>>({});
  const [freeTimeLoading, setFreeTimeLoading] = useState(true);
  const [freeTimeRequestInProgress, setFreeTimeRequestInProgress] = useState(false);
  const [freeTimeError, setFreeTimeError] = useState("");
  const [workPacketSignals, setWorkPacketSignals] = useState<WorkPacketSignalsStatus | null>(null);
  const [workPacketSignalsLoading, setWorkPacketSignalsLoading] = useState(true);
  const [workPacketSignalsRequestInProgress, setWorkPacketSignalsRequestInProgress] = useState(false);
  const [workPacketSignalsError, setWorkPacketSignalsError] = useState("");
  const [workPacketSignalPreview, setWorkPacketSignalPreview] = useState<WorkPacketSignalPreview | null>(null);
  const [operatorNoteWakes, setOperatorNoteWakes] = useState<OperatorNoteWakeStatus | null>(null);
  const [operatorNoteWakesLoading, setOperatorNoteWakesLoading] = useState(true);
  const [operatorNoteWakesRequestInProgress, setOperatorNoteWakesRequestInProgress] = useState(false);
  const [operatorNoteWakesError, setOperatorNoteWakesError] = useState("");
  const [wakeControlPolicy, setWakeControlPolicy] = useState<WakeControlPolicy | null>(null);
  const [wakeControlPolicyLoading, setWakeControlPolicyLoading] = useState(true);
  const [wakeControlPolicySaving, setWakeControlPolicySaving] = useState(false);
  const [wakeControlPolicyError, setWakeControlPolicyError] = useState("");
  const [operatorInboxPackets, setOperatorInboxPackets] = useState<WorkPacket[]>([]);
  const [operatorInboxOperatorNotes, setOperatorInboxOperatorNotes] = useState<OperatorNote[]>([]);
  const [operatorInboxLoading, setOperatorInboxLoading] = useState(true);
  const [operatorInboxError, setOperatorInboxError] = useState("");
  const [operatorInboxNotes, setOperatorInboxNotes] = useState<Record<string, string>>({});
  const [operatorNoteReplies, setOperatorNoteReplies] = useState<Record<string, string>>({});
  const [operatorNoteDetails, setOperatorNoteDetails] = useState<Record<string, OperatorNoteDetail>>({});
  const [operatorNoteExpanded, setOperatorNoteExpanded] = useState<Record<string, boolean>>({});
  const [operatorNoteTrailErrors, setOperatorNoteTrailErrors] = useState<Record<string, string>>({});
  const [operatorNoteTrailLoading, setOperatorNoteTrailLoading] = useState<Record<string, boolean>>({});
  const [operatorNoteDraft, setOperatorNoteDraft] = useState({
    agent: defaultAgent as OperatorNoteRecipient,
    subject: "",
    body: ""
  });
  const [operatorInboxActionInProgress, setOperatorInboxActionInProgress] = useState<string | null>(null);
  const [compactionPreview, setCompactionPreview] = useState<CompactionPreview | null>(null);
  const [compactionLoading, setCompactionLoading] = useState(false);
  const [compactionError, setCompactionError] = useState("");
  const [compactionCompile, setCompactionCompile] = useState<CompactionCompile | null>(null);
  const [checkpointDraft, setCheckpointDraft] = useState("");
  const [checkpointReceipt, setCheckpointReceipt] = useState<CompactionCheckpoint | null>(null);
  const [checkpointLoading, setCheckpointLoading] = useState(false);
  const [checkpointError, setCheckpointError] = useState("");
  const [compileLoading, setCompileLoading] = useState(false);
  const [compileError, setCompileError] = useState("");
  const [savedProposalLoading, setSavedProposalLoading] = useState(false);
  const [savedProposalError, setSavedProposalError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [controlPanels, setControlPanels] = useState<ControlPanelState>(expandedControlPanels);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const freeTimeStatusLoadedRef = useRef(false);
  const workPacketSignalsStatusLoadedRef = useRef(false);
  const operatorNoteWakesStatusLoadedRef = useRef(false);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.name === selectedAgent),
    [agents, selectedAgent]
  );
  const activeMessages = transcripts[selectedAgent] ?? [];
  const activeToolEvents = toolEvents[selectedAgent] ?? [];
  const pendingOperatorRollups = operatorInboxPackets.filter(isPendingOperatorRollup);
  const unreadOperatorNotes = operatorInboxOperatorNotes.filter((note) => note.operator_status === "unread");
  const operatorInboxCount = pendingOperatorRollups.length + unreadOperatorNotes.length;
  const barActivePresenceCount = (bar?.presence ?? []).filter((receipt) =>
    ["present", "degraded"].includes(receipt.state)
  ).length;
  const eyesActivePresenceCount = (eyes?.presence ?? []).filter((receipt) =>
    ["present", "degraded"].includes(receipt.state)
  ).length;
  const activeLiveSession = liveSession?.active_session ?? null;
  const liveSessionJoinedCount = activeLiveSession
    ? Object.values(activeLiveSession.participants).filter((participant) => participant?.status === "joined").length
    : 0;
  const activeHealth = health?.agents.find((agent) => agent.agent === selectedAgent);
  const activeMessageCount = activeHealth?.conversation.message_count ?? activeMessages.length;
  const hiddenOlderMessageCount = activeHealth
    ? Math.max(0, activeMessageCount - activeMessages.length)
    : 0;
  const displayMessages = useMemo(() => [...activeMessages].reverse(), [activeMessages]);
  const toolEventsByTurn = useMemo(() => {
    const eventsByTurn = new Map<string, ToolEvent[]>();

    for (const event of activeToolEvents) {
      if (!event.turn_id) {
        continue;
      }

      eventsByTurn.set(event.turn_id, [...(eventsByTurn.get(event.turn_id) ?? []), event]);
    }

    return eventsByTurn;
  }, [activeToolEvents]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 720px)").matches) {
      setControlPanels(collapsedControlPanels);
    }
  }, []);

  useEffect(() => {
    setWorkPacketSignalPreview(null);
  }, [selectedAgent]);

  const toggleControlPanel = useCallback((panel: ControlPanelKey) => {
    setControlPanels((current) => ({
      ...current,
      [panel]: !current[panel]
    }));
  }, []);

  const loadFreeTimeStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/free-time");
      const data = await readJsonResponse<FreeTimeStatus & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load Free Moments status.");
      }

      setFreeTime(data);
      setFreeTimeError("");
    } catch (statusError) {
      setFreeTimeError(
        statusError instanceof Error ? statusError.message : "Could not load Free Moments status."
      );
    } finally {
      setFreeTimeLoading(false);
    }
  }, []);

  const loadWorkPacketSignalsStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/work-packet-signals");
      const data = await readJsonResponse<WorkPacketSignalsStatus & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load Work Packet Signals status.");
      }

      setWorkPacketSignals(data);
      setWorkPacketSignalsError("");
    } catch (statusError) {
      setWorkPacketSignalsError(
        statusError instanceof Error
          ? statusError.message
          : "Could not load Work Packet Signals status."
      );
    } finally {
      setWorkPacketSignalsLoading(false);
    }
  }, []);

  const loadOperatorNoteWakesStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/operator-note-wakes");
      const data = await readJsonResponse<OperatorNoteWakeStatus & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load Operator Note WAKE status.");
      }

      setOperatorNoteWakes(data);
      setOperatorNoteWakesError("");
    } catch (statusError) {
      setOperatorNoteWakesError(
        statusError instanceof Error
          ? statusError.message
          : "Could not load Operator Note WAKE status."
      );
    } finally {
      setOperatorNoteWakesLoading(false);
    }
  }, []);

  const loadWakeControlPolicy = useCallback(async () => {
    setWakeControlPolicyLoading(true);

    try {
      const response = await fetch("/api/wake-control-policy");
      const data = await readJsonResponse<WakeControlPolicyResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load WAKE Control Policy.");
      }

      setWakeControlPolicy(data.policy);
      setWakeControlPolicyError("");
    } catch (statusError) {
      setWakeControlPolicyError(
        statusError instanceof Error
          ? statusError.message
          : "Could not load WAKE Control Policy."
      );
    } finally {
      setWakeControlPolicyLoading(false);
    }
  }, []);

  const loadOperatorInbox = useCallback(async () => {
    setOperatorInboxError("");
    setOperatorInboxLoading(true);

    try {
      const [packetsResponse, notesResponse] = await Promise.all([
        fetch("/api/work-packets?status=review&limit=12"),
        fetch("/api/operator-notes?status=open&limit=20")
      ]);
      const [packetsData, notesData] = await Promise.all([
        readJsonResponse<WorkPacketListResponse>(packetsResponse),
        readJsonResponse<OperatorNoteListResponse>(notesResponse)
      ]);
      const errors: string[] = [];

      if (packetsResponse.ok) {
        setOperatorInboxPackets(packetsData.packets ?? []);
      } else {
        errors.push(packetsData.error || "Could not load work packet rollups.");
      }

      if (notesResponse.ok) {
        setOperatorInboxOperatorNotes(notesData.notes ?? []);
      } else {
        setOperatorInboxOperatorNotes([]);
        errors.push(notesData.error || "Could not load Operator notes.");
      }

      if (errors.length) {
        throw new Error(errors.join(" "));
      }
    } catch (inboxError) {
      setOperatorInboxError(
        inboxError instanceof Error ? inboxError.message : "Could not load Operator Inbox."
      );
    } finally {
      setOperatorInboxLoading(false);
    }
  }, []);

  function clearOperatorNoteTrail(noteId: string) {
    setOperatorNoteDetails((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });
    setOperatorNoteTrailErrors((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });
    setOperatorNoteTrailLoading((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });
  }

  async function toggleOperatorNoteTrail(noteId: string) {
    const willExpand = !operatorNoteExpanded[noteId];

    setOperatorNoteExpanded((current) => ({
      ...current,
      [noteId]: willExpand
    }));

    if (!willExpand || operatorNoteDetails[noteId] || operatorNoteTrailLoading[noteId]) {
      return;
    }

    setOperatorNoteTrailLoading((current) => ({
      ...current,
      [noteId]: true
    }));
    setOperatorNoteTrailErrors((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });

    try {
      const response = await fetch(`/api/operator-notes?id=${encodeURIComponent(noteId)}`);
      const data = await readJsonResponse<OperatorNoteDetailResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load Operator note trail.");
      }

      setOperatorNoteDetails((current) => ({
        ...current,
        [noteId]: {
          note: data.note as OperatorNote,
          events: data.events ?? []
        }
      }));
    } catch (trailError) {
      setOperatorNoteTrailErrors((current) => ({
        ...current,
        [noteId]:
          trailError instanceof Error ? trailError.message : "Could not load Operator note trail."
      }));
    } finally {
      setOperatorNoteTrailLoading((current) => ({
        ...current,
        [noteId]: false
      }));
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAgents() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/agents");
        const data = await readJsonResponse<AgentsResponse>(response);

        if (!response.ok) {
          throw new Error(data.error || "Could not load agents.");
        }

        if (!cancelled) {
          setAgents(data.agents ?? []);
          setTranscripts(data.transcripts ?? {});
          setToolEvents(data.tool_events ?? {});

          if (data.agents?.some((agent: Agent) => agent.name === defaultAgent)) {
            setSelectedAgent(defaultAgent);
          } else if (data.agents?.[0]?.name) {
            setSelectedAgent(data.agents[0].name);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load agents.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAgents();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadCafe = useCallback(async () => {
    setCafeError("");

    try {
      const response = await fetch("/api/cafe");
      const data = await readJsonResponse<CafeState & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load Cafe.");
      }

      setCafe(data);
    } catch (loadCafeError) {
      setCafeError(loadCafeError instanceof Error ? loadCafeError.message : "Could not load Cafe.");
      setCafe(null);
    } finally {
      setCafeLoading(false);
    }
  }, []);

  const loadBar = useCallback(async () => {
    setBarError("");

    try {
      const response = await fetch("/api/bar");
      const data = await readJsonResponse<BarState & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load BAR.");
      }

      setBar(data);
    } catch (loadBarError) {
      setBarError(loadBarError instanceof Error ? loadBarError.message : "Could not load BAR.");
      setBar(null);
    } finally {
      setBarLoading(false);
    }
  }, []);

  const loadEyes = useCallback(async () => {
    setEyesError("");

    try {
      const response = await fetch("/api/eyes");
      const data = await readJsonResponse<EyesState & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load EYES.");
      }

      setEyes(data);
    } catch (loadEyesError) {
      setEyesError(loadEyesError instanceof Error ? loadEyesError.message : "Could not load EYES.");
      setEyes(null);
    } finally {
      setEyesLoading(false);
    }
  }, []);

  const loadLiveSessionStatus = useCallback(async () => {
    setLiveSessionError("");

    try {
      const response = await fetch("/api/live-sessions");
      const data = await readJsonResponse<LiveSessionStatus & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load Live Session Host.");
      }

      setLiveSession(data);
      const policy = data.active_session?.tick_policy;
      if (policy) {
        setLiveSessionDraft((current) => ({
          ...current,
          tickMode: policy.mode,
          intervalSeconds: policy.interval_seconds ?? current.intervalSeconds
        }));
      }
    } catch (loadLiveSessionError) {
      setLiveSessionError(
        loadLiveSessionError instanceof Error
          ? loadLiveSessionError.message
          : "Could not load Live Session Host."
      );
      setLiveSession(null);
    } finally {
      setLiveSessionLoading(false);
    }
  }, []);

  const loadLaunchpadStatus = useCallback(async () => {
    setLaunchpadError("");

    try {
      const response = await fetch("/api/launchpad");
      const data = await readJsonResponse<LaunchpadStatus & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load Launchpad.");
      }

      setLaunchpad(data);
    } catch (loadLaunchpadError) {
      setLaunchpadError(
        loadLaunchpadError instanceof Error ? loadLaunchpadError.message : "Could not load Launchpad."
      );
      setLaunchpad(null);
    } finally {
      setLaunchpadLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCafe();
  }, [loadCafe]);

  useEffect(() => {
    void loadBar();
  }, [loadBar]);

  useEffect(() => {
    void loadEyes();
  }, [loadEyes]);

  useEffect(() => {
    void loadLiveSessionStatus();
  }, [loadLiveSessionStatus]);

  useEffect(() => {
    void loadLaunchpadStatus();
  }, [loadLaunchpadStatus]);

  useEffect(() => {
    void loadOperatorInbox();
  }, [loadOperatorInbox]);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetch("/api/health");
        const data = await readJsonResponse<Health & { error?: string }>(response);

        if (!response.ok) {
          throw new Error(data.error || "Could not load runtime health.");
        }

        if (!cancelled) {
          setHealth(data);
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
        }
      }
    }

    loadHealth();

    return () => {
      cancelled = true;
    };
  }, [activeMessages.length, selectedAgent]);

  useEffect(() => {
    const shouldPoll = Boolean(
      freeTime?.running || freeTime?.turn_in_progress || freeTimeRequestInProgress
    );

    if (!freeTimeStatusLoadedRef.current) {
      freeTimeStatusLoadedRef.current = true;
      void loadFreeTimeStatus();
    }

    if (!shouldPoll) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadFreeTimeStatus();
    }, freeTimePollMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [freeTime?.running, freeTime?.turn_in_progress, freeTimeRequestInProgress, loadFreeTimeStatus]);

  useEffect(() => {
    const shouldPoll = Boolean(
      workPacketSignals?.running ||
      workPacketSignals?.check_in_progress ||
      workPacketSignalsRequestInProgress
    );

    if (!workPacketSignalsStatusLoadedRef.current) {
      workPacketSignalsStatusLoadedRef.current = true;
      void loadWorkPacketSignalsStatus();
    }

    if (!shouldPoll) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadWorkPacketSignalsStatus();
    }, workPacketSignalsPollMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    workPacketSignals?.running,
    workPacketSignals?.check_in_progress,
    workPacketSignalsRequestInProgress,
    loadWorkPacketSignalsStatus
  ]);

  useEffect(() => {
    const shouldPoll = Boolean(
      operatorNoteWakes?.enabled ||
      operatorNoteWakesRequestInProgress
    );

    if (!operatorNoteWakesStatusLoadedRef.current) {
      operatorNoteWakesStatusLoadedRef.current = true;
      void loadOperatorNoteWakesStatus();
    }

    if (!shouldPoll) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadOperatorNoteWakesStatus();
    }, workPacketSignalsPollMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    operatorNoteWakes?.enabled,
    operatorNoteWakesRequestInProgress,
    loadOperatorNoteWakesStatus
  ]);

  useEffect(() => {
    void loadWakeControlPolicy();
  }, [loadWakeControlPolicy]);

  useEffect(() => {
    const activeSession = liveSession?.active_session;

    if (!activeSession || liveSession?.runner.status !== "running") {
      return;
    }

    const interval = window.setInterval(() => {
      void loadLiveSessionStatus();
      void loadBar();
      void loadEyes();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    liveSession?.active_session?.id,
    liveSession?.runner.status,
    loadBar,
    loadEyes,
    loadLiveSessionStatus
  ]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }, [activeMessages.length, selectedAgent]);

  useEffect(() => {
    setCompactionPreview(null);
    setCompactionCompile(null);
    setCheckpointDraft("");
    setCheckpointReceipt(null);
    setCompactionError("");
    setCompileError("");
    setSavedProposalError("");
    setCheckpointError("");
    setPendingAttachments([]);
  }, [selectedAgent]);

  async function previewCompaction() {
    setCompactionLoading(true);
    setCompactionError("");
    setCompactionCompile(null);
    setCheckpointDraft("");
    setCheckpointReceipt(null);
    setCompileError("");
    setCheckpointError("");

    try {
      const response = await fetch("/api/compaction/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agent: selectedAgent
        })
      });
      const data = await readJsonResponse<CompactionPreview & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not review the room.");
      }

      setCompactionPreview(data);
    } catch (previewError) {
      setCompactionError(
        previewError instanceof Error ? previewError.message : "Could not review the room."
      );
    } finally {
      setCompactionLoading(false);
    }
  }

  async function compileCompactionProposal() {
    setCompileLoading(true);
    setCompileError("");

    try {
      const response = await fetch("/api/compaction/compile", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agent: selectedAgent
        })
      });
      const data = await readJsonResponse<CompactionCompile & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not draft the room note.");
      }

      setCompactionCompile(data);
      setCheckpointDraft(data.proposal ?? "");
      setCheckpointReceipt(null);
    } catch (compileFailure) {
      setCompileError(
        compileFailure instanceof Error ? compileFailure.message : "Could not draft the room note."
      );
    } finally {
      setCompileLoading(false);
    }
  }

  async function loadApprovedCompactionProposal() {
    setSavedProposalLoading(true);
    setSavedProposalError("");
    setCompileError("");

    try {
      const response = await fetch("/api/compaction/proposal", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agent: selectedAgent,
          status: "agent_approved"
        })
      });
      const data = await readJsonResponse<{
        error?: string;
        proposal?: {
          id: string;
          updated_at: string;
          proposal: string;
          source_summary: unknown;
          status: string;
          agent_notes: string | null;
        };
      }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not load the approved note.");
      }

      if (!data.proposal) {
        throw new Error("Approved note response did not include a proposal.");
      }

      setCompactionCompile({
        agent: selectedAgent,
        destructive: false,
        dry_run: false,
        generated_at: data.proposal.updated_at,
        next_step: "Review the loaded approved room note, then send housekeeping.",
        proposal: data.proposal.proposal,
        source: sourceSummaryFromSavedProposal(data.proposal.source_summary),
        status: "saved_proposal_loaded",
        saved_proposal_id: data.proposal.id,
        saved_proposal_status: data.proposal.status,
        agent_notes: data.proposal.agent_notes
      });
      setCheckpointDraft(data.proposal.proposal ?? "");
      setCheckpointReceipt(null);
    } catch (loadFailure) {
      setSavedProposalError(
        loadFailure instanceof Error ? loadFailure.message : "Could not load the approved note."
      );
    } finally {
      setSavedProposalLoading(false);
    }
  }

  async function createCompactionCheckpoint() {
    const summary = checkpointDraft.trim();

    if (!summary || checkpointLoading) {
      return;
    }

    setCheckpointLoading(true);
    setCheckpointError("");

    try {
      const response = await fetch("/api/compaction/checkpoint", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agent: selectedAgent,
          summary,
          approved_by: "operator",
          approval_note: compactionCompile?.saved_proposal_id
            ? `Operator-created room refresh from saved approved proposal ${compactionCompile.saved_proposal_id}.`
            : "Operator-created room refresh from reviewed room note.",
          source: compactionCompile?.saved_proposal_id
            ? `saved_compaction_proposal:${compactionCompile.saved_proposal_id}`
            : "compiled_compaction_proposal"
        })
      });
      const data = await readJsonResponse<CompactionCheckpoint & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not send housekeeping.");
      }

      setCheckpointReceipt(data);

      const healthResponse = await fetch("/api/health");
      const healthData = await readJsonResponse<Health & { error?: string }>(healthResponse);

      if (healthResponse.ok) {
        setHealth(healthData);
      }
    } catch (checkpointFailure) {
      setCheckpointError(
        checkpointFailure instanceof Error
          ? checkpointFailure.message
          : "Could not send housekeeping."
      );
    } finally {
      setCheckpointLoading(false);
    }
  }

  async function runFreeTimeAction(action: "start" | "stop" | "tick") {
    if (freeTimeRequestInProgress) {
      return;
    }

    setFreeTimeRequestInProgress(true);
    setFreeTimeError("");

    try {
      const response = await fetch("/api/free-time", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(action === "tick" ? { action, agent: selectedAgent } : { action })
      });
      const data = await readJsonResponse<FreeTimeStatus & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Free Moments request failed.");
      }

      setFreeTime(data);
    } catch (actionError) {
      setFreeTimeError(
        actionError instanceof Error ? actionError.message : "Free Moments request failed."
      );
    } finally {
      setFreeTimeRequestInProgress(false);
      setFreeTimeLoading(false);
    }
  }

  async function runWorkPacketSignalsAction(action: "start" | "stop" | "start_wakes" | "stop_wakes" | "tick") {
    if (workPacketSignalsRequestInProgress) {
      return;
    }

    setWorkPacketSignalsRequestInProgress(true);
    setWorkPacketSignalsError("");

    try {
      const response = await fetch("/api/work-packet-signals", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ action })
      });
      const data = await readJsonResponse<WorkPacketSignalsStatus & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Work Packet Signals request failed.");
      }

      setWorkPacketSignals(data);
    } catch (actionError) {
      setWorkPacketSignalsError(
        actionError instanceof Error
          ? actionError.message
          : "Work Packet Signals request failed."
      );
    } finally {
      setWorkPacketSignalsRequestInProgress(false);
      setWorkPacketSignalsLoading(false);
    }
  }

  async function runOperatorNoteWakesAction(action: "start" | "stop" | "check") {
    if (operatorNoteWakesRequestInProgress) {
      return;
    }

    setOperatorNoteWakesRequestInProgress(true);
    setOperatorNoteWakesError("");

    try {
      const response = await fetch("/api/operator-note-wakes", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ action })
      });
      const data = await readJsonResponse<OperatorNoteWakeStatus & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Operator Note WAKE request failed.");
      }

      setOperatorNoteWakes(data);
    } catch (actionError) {
      setOperatorNoteWakesError(
        actionError instanceof Error
          ? actionError.message
          : "Operator Note WAKE request failed."
      );
    } finally {
      setOperatorNoteWakesRequestInProgress(false);
      setOperatorNoteWakesLoading(false);
    }
  }

  async function runLiveSessionAction(action: "start" | "end" | "tick" | "dry_run" | "set_policy") {
    if (liveSessionRequestInProgress) {
      return;
    }

    setLiveSessionRequestInProgress(true);
    setLiveSessionError("");

    try {
      const response = await fetch("/api/live-sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(liveSessionRequestBody(action, liveSessionDraft))
      });
      const data = await readJsonResponse<
        (LiveSessionStatus & { error?: string }) | { session?: LiveSession | null; results?: unknown[]; error?: string }
      >(response);

      if (!response.ok) {
        throw new Error(data.error || "Live Session request failed.");
      }

      await loadLiveSessionStatus();
      await loadBar();
      await loadEyes();
    } catch (actionError) {
      setLiveSessionError(
        actionError instanceof Error ? actionError.message : "Live Session request failed."
      );
    } finally {
      setLiveSessionRequestInProgress(false);
      setLiveSessionLoading(false);
    }
  }

  async function runLaunchpadAction(action: "preview" | "create" | "end") {
    if (launchpadRequestInProgress) {
      return;
    }

    setLaunchpadRequestInProgress(true);
    setLaunchpadError("");

    try {
      const response = await fetch("/api/launchpad", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(launchpadRequestBody(
          action,
          launchpadDraft,
          liveSession?.active_session?.id ?? launchpad?.active_live_session_id ?? launchpadPreview?.session_id ?? undefined
        ))
      });
      const data = await readJsonResponse<{
        invitation?: LaunchpadInvitation | null;
        session?: LiveSession | null;
        error?: string;
      }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Launchpad request failed.");
      }

      if (data.invitation) {
        setLaunchpadPreview(data.invitation);
      } else if (action === "end") {
        setLaunchpadPreview(null);
      }
      await loadLaunchpadStatus();
      await loadLiveSessionStatus();
      await loadBar();
      await loadEyes();
    } catch (actionError) {
      setLaunchpadError(
        actionError instanceof Error ? actionError.message : "Launchpad request failed."
      );
    } finally {
      setLaunchpadRequestInProgress(false);
      setLaunchpadLoading(false);
    }
  }

  async function toggleLiveSessionAgent(agent: LiveSessionAgent, enabled: boolean) {
    const activeSession = liveSession?.active_session;

    if (agent === "soren" || agent === "varro") {
      setLiveSessionDraft((current) => ({
        ...current,
        nativeAgents: {
          ...current.nativeAgents,
          [agent]: enabled
        }
      }));
    } else {
      setLiveSessionDraft((current) => ({
        ...current,
        bridgeAgents: {
          ...current.bridgeAgents,
          [agent]: enabled
        }
      }));
    }

    if (!activeSession || liveSessionRequestInProgress) {
      return;
    }

    setLiveSessionRequestInProgress(true);
    setLiveSessionError("");

    try {
      const response = await fetch("/api/live-sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: enabled ? "join" : "leave",
          session_id: activeSession.id,
          agent
        })
      });
      const data = await readJsonResponse<{ session?: LiveSession | null; error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Live Session participant update failed.");
      }

      await loadLiveSessionStatus();
      await loadBar();
    } catch (actionError) {
      setLiveSessionError(
        actionError instanceof Error
          ? actionError.message
          : "Live Session participant update failed."
      );
    } finally {
      setLiveSessionRequestInProgress(false);
      setLiveSessionLoading(false);
    }
  }

  async function saveWakeControlPolicy(nextPolicy: WakeControlPolicy | null) {
    if (wakeControlPolicySaving) {
      return;
    }

    setWakeControlPolicySaving(true);
    setWakeControlPolicyError("");

    try {
      const response = await fetch("/api/wake-control-policy", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ policy: nextPolicy })
      });
      const data = await readJsonResponse<WakeControlPolicyResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "WAKE Control Policy request failed.");
      }

      setWakeControlPolicy(data.policy);
    } catch (actionError) {
      setWakeControlPolicyError(
        actionError instanceof Error
          ? actionError.message
          : "WAKE Control Policy request failed."
      );
    } finally {
      setWakeControlPolicySaving(false);
      setWakeControlPolicyLoading(false);
    }
  }

  function updateWakeControlPolicy(updater: (policy: WakeControlPolicy) => WakeControlPolicy) {
    void saveWakeControlPolicy(updater(cloneWakeControlPolicy(wakeControlPolicy)));
  }

  function toggleWakeAgent(scopeId: WakeControlAgentId, enabled: boolean) {
    updateWakeControlPolicy((policy) => setWakeAgentEnabled(policy, scopeId, enabled));
  }

  function toggleWakeTrigger(scopeId: WakeControlAgentId, trigger: WakeControlTrigger, enabled: boolean) {
    updateWakeControlPolicy((policy) => setWakeTriggerEnabled(policy, scopeId, trigger, enabled));
  }

  function toggleWakeMention(scopeId: WakeControlAgentId, trigger: WakeControlTrigger, enabled: boolean) {
    updateWakeControlPolicy((policy) => setWakeMentionEnabled(policy, scopeId, trigger, enabled));
  }

  async function previewWorkPacketSignals() {
    if (workPacketSignalsRequestInProgress) {
      return;
    }

    setWorkPacketSignalsRequestInProgress(true);
    setWorkPacketSignalsError("");

    try {
      const response = await fetch("/api/work-packet-signals", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ action: "preview_agent", agent: selectedAgent })
      });
      const data = await readJsonResponse<WorkPacketSignalPreview & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Packet Signals preview failed.");
      }

      setWorkPacketSignalPreview(data);
      void loadWorkPacketSignalsStatus();
    } catch (previewError) {
      setWorkPacketSignalsError(
        previewError instanceof Error ? previewError.message : "Packet Signals preview failed."
      );
    } finally {
      setWorkPacketSignalsRequestInProgress(false);
      setWorkPacketSignalsLoading(false);
    }
  }

  async function reviewOperatorRollup(packetId: string, reviewState: "approved" | "request_changes" | "hold") {
    if (operatorInboxActionInProgress) {
      return;
    }

    setOperatorInboxActionInProgress(`${packetId}:${reviewState}`);
    setOperatorInboxError("");

    try {
      const response = await fetch("/api/work-packets", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "review_rollup",
          id: packetId,
          review_state: reviewState,
          note: operatorInboxNotes[packetId] ?? ""
        })
      });
      const data = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not review rollup.");
      }

      setOperatorInboxNotes((current) => {
        const next = { ...current };
        delete next[packetId];
        return next;
      });
      await loadOperatorInbox();
      void loadWorkPacketSignalsStatus();
    } catch (reviewError) {
      setOperatorInboxError(
        reviewError instanceof Error ? reviewError.message : "Could not review rollup."
      );
    } finally {
      setOperatorInboxActionInProgress(null);
    }
  }

  async function updateOperatorNote(
    noteId: string,
    action: "reply" | "mark_read" | "archive",
    body = ""
  ) {
    if (operatorInboxActionInProgress) {
      return;
    }

    setOperatorInboxActionInProgress(`${noteId}:${action}`);
    setOperatorInboxError("");

    try {
      const response = await fetch("/api/operator-notes", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action,
          id: noteId,
          body
        })
      });
      const data = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not update Operator note.");
      }

      if (action === "reply") {
        setOperatorNoteReplies((current) => {
          const next = { ...current };
          delete next[noteId];
          return next;
        });
      }
      clearOperatorNoteTrail(noteId);
      setOperatorNoteExpanded((current) => {
        const next = { ...current };
        delete next[noteId];
        return next;
      });

      await loadOperatorInbox();
      void loadOperatorNoteWakesStatus();
    } catch (noteError) {
      setOperatorInboxError(
        noteError instanceof Error ? noteError.message : "Could not update Operator note."
      );
    } finally {
      setOperatorInboxActionInProgress(null);
    }
  }

  async function createOperatorNote() {
    if (operatorInboxActionInProgress || !operatorNoteDraft.body.trim()) {
      return;
    }

    setOperatorInboxActionInProgress("operator-note:create");
    setOperatorInboxError("");

    try {
      const recipients = operatorNoteDraft.agent === "all"
        ? OPERATOR_NOTE_RECIPIENTS
        : [operatorNoteDraft.agent];

      await Promise.all(
        recipients.map(async (agent) => {
          const response = await fetch("/api/operator-notes", {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              action: "create",
              agent,
              subject: operatorNoteDraft.subject,
              body: operatorNoteDraft.body
            })
          });
          const data = await readJsonResponse<{ error?: string }>(response);

          if (!response.ok) {
            throw new Error(
              data.error || `Could not create Operator note for ${participantDisplayName(`agent:${agent}`)}.`
            );
          }
        })
      );

      setOperatorNoteDraft((current) => ({
        ...current,
        subject: "",
        body: ""
      }));
      await loadOperatorInbox();
      void loadOperatorNoteWakesStatus();
    } catch (noteError) {
      setOperatorInboxError(
        noteError instanceof Error ? noteError.message : "Could not create Operator note."
      );
    } finally {
      setOperatorInboxActionInProgress(null);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    const hasAttachments = pendingAttachments.length > 0;

    if ((!trimmed && !hasAttachments) || sending) {
      return;
    }

    setSending(true);
    setError("");
    setMessage("");

    try {
      const uploadedAttachments = await uploadQueuedAttachments();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agent: selectedAgent,
          message: trimmed,
          attachments: uploadedAttachments.map((attachment) => ({ id: attachment.id }))
        })
      });
      const data = await readJsonResponse<ChatResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "Message failed.");
      }

      setTranscripts((current) => ({
        ...current,
        [selectedAgent]: trimLiveMessages([
          ...(current[selectedAgent] ?? []),
          ...(data.messages ?? [])
        ])
      }));
      setToolEvents((current) => ({
        ...current,
        [selectedAgent]: [...(current[selectedAgent] ?? []), ...(data.tool_events ?? [])]
      }));
      setPendingAttachments([]);
    } catch (sendError) {
      setMessage(trimmed);
      setError(sendError instanceof Error ? sendError.message : "Message failed.");
    } finally {
      setSending(false);
    }
  }

  async function sendCafeMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = cafeMessage.trim();
    const hasAttachments = cafePendingAttachments.length > 0;

    if ((!trimmed && !hasAttachments) || cafeSending) {
      return;
    }

    setCafeSending(true);
    setCafeError("");
    setCafeMessage("");

    try {
      const uploadedAttachments = await uploadQueuedCafeAttachments();
      const response = await fetch("/api/cafe", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          message: trimmed,
          attachments: uploadedAttachments.map((attachment) => ({ id: attachment.id }))
        })
      });
      const data = await readJsonResponse<CafeState & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Cafe message failed.");
      }

      setCafe(data);
      setCafePendingAttachments([]);
    } catch (sendCafeError) {
      setCafeMessage(trimmed);
      setCafeError(sendCafeError instanceof Error ? sendCafeError.message : "Cafe message failed.");
    } finally {
      setCafeSending(false);
    }
  }

  async function sendBarMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = barMessage.trim();
    const hasAttachments = barPendingAttachments.length > 0;

    if ((!trimmed && !hasAttachments) || barSending) {
      return;
    }

    setBarSending(true);
    setBarError("");
    setBarMessage("");

    try {
      const uploadedAttachments = await uploadQueuedBarAttachments();
      const response = await fetch("/api/bar", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "post",
          content: trimmed,
          participant_id: "operator:chris",
          participant_type: "operator",
          display_name: "Chris",
          attachments: uploadedAttachments.map((attachment) => ({ id: attachment.id }))
        })
      });
      const data = await readJsonResponse<BarState & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not post to BAR.");
      }

      setBar(data);
      setBarPendingAttachments([]);
    } catch (sendBarError) {
      setBarMessage(trimmed);
      setBarError(sendBarError instanceof Error ? sendBarError.message : "Could not post to BAR.");
    } finally {
      setBarSending(false);
      setBarLoading(false);
    }
  }

  async function sendEyesMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = eyesMessage.trim();
    const hasFrames = eyesPendingFrames.length > 0;

    if ((!trimmed && !hasFrames) || eyesSending) {
      return;
    }

    setEyesSending(true);
    setEyesError("");
    setEyesMessage("");

    try {
      const uploadedFrames = await uploadQueuedEyesFrames();
      const response = await fetch("/api/eyes", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: uploadedFrames.length ? "capture" : "post",
          content: trimmed,
          participant_id: "operator:chris",
          participant_type: "operator",
          display_name: "Chris",
          frames: uploadedFrames.map((frame) => ({ id: frame.id }))
        })
      });
      const data = await readJsonResponse<EyesState & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not post to EYES.");
      }

      setEyes(data);
      setEyesPendingFrames([]);
    } catch (sendEyesError) {
      setEyesMessage(trimmed);
      setEyesError(sendEyesError instanceof Error ? sendEyesError.message : "Could not post to EYES.");
    } finally {
      setEyesSending(false);
      setEyesLoading(false);
    }
  }

  function addCafeFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files);

    if (!nextFiles.length) {
      return;
    }

    setCafePendingAttachments((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        localId: createLocalId(),
        file,
        status: "queued" as const
      }))
    ]);
  }

  function removeCafeAttachment(localId: string) {
    setCafePendingAttachments((current) =>
      current.filter((attachment) => attachment.localId !== localId)
    );
  }

  function addBarFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files);

    if (!nextFiles.length) {
      return;
    }

    setBarPendingAttachments((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        localId: createLocalId(),
        file,
        status: "queued" as const
      }))
    ]);
  }

  function removeBarAttachment(localId: string) {
    setBarPendingAttachments((current) =>
      current.filter((attachment) => attachment.localId !== localId)
    );
  }

  function addEyesFrames(files: FileList | File[]) {
    const nextFiles = Array.from(files);

    if (!nextFiles.length) {
      return;
    }

    setEyesPendingFrames((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        localId: createLocalId(),
        file,
        status: "queued" as const
      }))
    ]);
  }

  function removeEyesFrame(localId: string) {
    setEyesPendingFrames((current) =>
      current.filter((attachment) => attachment.localId !== localId)
    );
  }

  function addFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files);

    if (!nextFiles.length) {
      return;
    }

    setPendingAttachments((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        localId: createLocalId(),
        file,
        status: "queued" as const
      }))
    ]);
  }

  function removeAttachment(localId: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.localId !== localId));
  }

  async function uploadQueuedAttachments() {
    const queued = pendingAttachments.filter((attachment) => attachment.status !== "uploaded");
    const uploaded = pendingAttachments
      .filter((attachment) => attachment.status === "uploaded" && attachment.material)
      .map((attachment) => attachment.material as UploadedAttachment);

    if (!queued.length) {
      return uploaded;
    }

    setPendingAttachments((current) =>
      current.map((attachment) =>
        queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
          ? { ...attachment, status: "uploading", error: undefined }
          : attachment
      )
    );

    const formData = new FormData();
    formData.append("agent", selectedAgent);

    for (const attachment of queued) {
      formData.append("files", attachment.file);
    }

    const response = await fetch("/api/source-materials/upload", {
      method: "POST",
      body: formData
    });
    const data = await readJsonResponse<SourceMaterialUploadResponse>(response);

    if (!response.ok) {
      setPendingAttachments((current) =>
        current.map((attachment) =>
          queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
            ? { ...attachment, status: "error", error: data.error || "Upload failed." }
            : attachment
        )
      );
      throw new Error(data.error || "Upload failed.");
    }

    const materials = (data.materials ?? []) as UploadedAttachment[];

    if (materials.length !== queued.length) {
      setPendingAttachments((current) =>
        current.map((attachment) =>
          queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
            ? { ...attachment, status: "error", error: "Upload response did not match selected files." }
            : attachment
        )
      );
      throw new Error("Upload response did not match selected files.");
    }

    setPendingAttachments((current) =>
      current.map((attachment) => {
        const queuedIndex = queued.findIndex((queuedAttachment) => queuedAttachment.localId === attachment.localId);

        if (queuedIndex === -1) {
          return attachment;
        }

        return {
          ...attachment,
          status: "uploaded",
          material: materials[queuedIndex],
          error: undefined
        };
      })
    );

    return [...uploaded, ...materials];
  }

  async function uploadQueuedCafeAttachments() {
    const queued = cafePendingAttachments.filter((attachment) => attachment.status !== "uploaded");
    const uploaded = cafePendingAttachments
      .filter((attachment) => attachment.status === "uploaded" && attachment.material)
      .map((attachment) => attachment.material as UploadedAttachment);

    if (!queued.length) {
      return uploaded;
    }

    setCafePendingAttachments((current) =>
      current.map((attachment) =>
        queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
          ? { ...attachment, status: "uploading", error: undefined }
          : attachment
      )
    );

    const formData = new FormData();

    for (const attachment of queued) {
      formData.append("files", attachment.file);
    }

    const response = await fetch("/api/source-materials/cafe-upload", {
      method: "POST",
      body: formData
    });
    const data = await readJsonResponse<SourceMaterialUploadResponse>(response);

    if (!response.ok) {
      setCafePendingAttachments((current) =>
        current.map((attachment) =>
          queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
            ? { ...attachment, status: "error", error: data.error || "Upload failed." }
            : attachment
        )
      );
      throw new Error(data.error || "Upload failed.");
    }

    const materials = (data.materials ?? []) as UploadedAttachment[];

    if (materials.length !== queued.length) {
      setCafePendingAttachments((current) =>
        current.map((attachment) =>
          queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
            ? { ...attachment, status: "error", error: "Upload response did not match selected files." }
            : attachment
        )
      );
      throw new Error("Upload response did not match selected files.");
    }

    setCafePendingAttachments((current) =>
      current.map((attachment) => {
        const queuedIndex = queued.findIndex(
          (queuedAttachment) => queuedAttachment.localId === attachment.localId
        );

        if (queuedIndex === -1) {
          return attachment;
        }

        return {
          ...attachment,
          status: "uploaded",
          material: materials[queuedIndex],
          error: undefined
        };
      })
    );

    return [...uploaded, ...materials];
  }

  async function uploadQueuedBarAttachments() {
    const queued = barPendingAttachments.filter((attachment) => attachment.status !== "uploaded");
    const uploaded = barPendingAttachments
      .filter((attachment) => attachment.status === "uploaded" && attachment.material)
      .map((attachment) => attachment.material as UploadedAttachment);

    if (!queued.length) {
      return uploaded;
    }

    setBarPendingAttachments((current) =>
      current.map((attachment) =>
        queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
          ? { ...attachment, status: "uploading", error: undefined }
          : attachment
      )
    );

    const formData = new FormData();

    for (const attachment of queued) {
      formData.append("files", attachment.file);
    }

    const response = await fetch("/api/source-materials/bar-upload", {
      method: "POST",
      body: formData
    });
    const data = await readJsonResponse<SourceMaterialUploadResponse>(response);

    if (!response.ok) {
      setBarPendingAttachments((current) =>
        current.map((attachment) =>
          queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
            ? { ...attachment, status: "error", error: data.error || "Upload failed." }
            : attachment
        )
      );
      throw new Error(data.error || "Upload failed.");
    }

    const materials = (data.materials ?? []) as UploadedAttachment[];

    if (materials.length !== queued.length) {
      setBarPendingAttachments((current) =>
        current.map((attachment) =>
          queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
            ? { ...attachment, status: "error", error: "Upload response did not match selected files." }
            : attachment
        )
      );
      throw new Error("Upload response did not match selected files.");
    }

    setBarPendingAttachments((current) =>
      current.map((attachment) => {
        const queuedIndex = queued.findIndex(
          (queuedAttachment) => queuedAttachment.localId === attachment.localId
        );

        if (queuedIndex === -1) {
          return attachment;
        }

        return {
          ...attachment,
          status: "uploaded",
          material: materials[queuedIndex],
          error: undefined
        };
      })
    );

    return [...uploaded, ...materials];
  }

  async function uploadQueuedEyesFrames() {
    const queued = eyesPendingFrames.filter((attachment) => attachment.status !== "uploaded");
    const uploaded = eyesPendingFrames
      .filter((attachment) => attachment.status === "uploaded" && attachment.material)
      .map((attachment) => attachment.material as UploadedAttachment);

    if (!queued.length) {
      return uploaded;
    }

    setEyesPendingFrames((current) =>
      current.map((attachment) =>
        queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
          ? { ...attachment, status: "uploading", error: undefined }
          : attachment
      )
    );

    const formData = new FormData();

    for (const attachment of queued) {
      formData.append("files", attachment.file);
    }

    const response = await fetch("/api/source-materials/eyes-upload", {
      method: "POST",
      body: formData
    });
    const data = await readJsonResponse<SourceMaterialUploadResponse>(response);

    if (!response.ok) {
      setEyesPendingFrames((current) =>
        current.map((attachment) =>
          queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
            ? { ...attachment, status: "error", error: data.error || "Upload failed." }
            : attachment
        )
      );
      throw new Error(data.error || "Upload failed.");
    }

    const materials = (data.materials ?? []) as UploadedAttachment[];

    if (materials.length !== queued.length) {
      setEyesPendingFrames((current) =>
        current.map((attachment) =>
          queued.some((queuedAttachment) => queuedAttachment.localId === attachment.localId)
            ? { ...attachment, status: "error", error: "Upload response did not match selected files." }
            : attachment
        )
      );
      throw new Error("Upload response did not match selected files.");
    }

    setEyesPendingFrames((current) =>
      current.map((attachment) => {
        const queuedIndex = queued.findIndex(
          (queuedAttachment) => queuedAttachment.localId === attachment.localId
        );

        if (queuedIndex === -1) {
          return attachment;
        }

        return {
          ...attachment,
          status: "uploaded",
          material: materials[queuedIndex],
          error: undefined
        };
      })
    );

    return [...uploaded, ...materials];
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <h1>Agents</h1>
        <button
          className={`cafe-button ${activeSurface === "cafe" ? "active" : ""}`}
          onClick={() => setActiveSurface("cafe")}
          type="button"
        >
          <strong>Cafe</strong>
          <br />
          <span>shared room</span>
        </button>
        <button
          className={`cafe-button ${activeSurface === "bar" ? "active" : ""}`}
          onClick={() => {
            setActiveSurface("bar");
            void loadBar();
          }}
          type="button"
        >
          <strong>BAR</strong>
          <br />
          <span>{barActivePresenceCount} here</span>
        </button>
        <button
          className={`cafe-button ${activeSurface === "eyes" ? "active" : ""}`}
          onClick={() => {
            setActiveSurface("eyes");
            void loadEyes();
          }}
          type="button"
        >
          <strong>EYES</strong>
          <br />
          <span>{eyesActivePresenceCount} here</span>
        </button>
        <button
          className={`cafe-button ${activeSurface === "inbox" ? "active" : ""}`}
          onClick={() => {
            setActiveSurface("inbox");
            void loadOperatorInbox();
          }}
          type="button"
        >
          <strong>Inbox</strong>
          <br />
          <span>{operatorInboxCount} item{operatorInboxCount === 1 ? "" : "s"}</span>
        </button>
        <div className="agent-list">
          {agents.map((agent) => (
            <button
              className={`agent-button ${
                activeSurface === "chat" && agent.name === selectedAgent ? "active" : ""
              }`}
              disabled={sending}
              key={agent.name}
              onClick={() => {
                setSelectedAgent(agent.name);
                setActiveSurface("chat");
              }}
              type="button"
            >
              <strong>{agent.display_name ?? agent.name}</strong>
              <br />
              <span>{agent.status ?? "active"}</span>
            </button>
          ))}
        </div>

        <RuntimeHealthPanel
          activeHealth={activeHealth}
          compactionError={compactionError}
          compactionLoading={compactionLoading}
          compactionPreview={compactionPreview}
          compileError={compileError}
          compileLoading={compileLoading}
          expanded={controlPanels.runtime}
          health={health}
          onCompileProposal={compileCompactionProposal}
          onToggle={() => toggleControlPanel("runtime")}
          onLoadApprovedProposal={loadApprovedCompactionProposal}
          onPreviewCompaction={previewCompaction}
          savedProposalError={savedProposalError}
          savedProposalLoading={savedProposalLoading}
        />

        <FreeTimePanel
          selectedAgent={selectedAgent}
          error={freeTimeError}
          expanded={controlPanels.freeMoments}
          loading={freeTimeLoading}
          onAction={runFreeTimeAction}
          onToggle={() => toggleControlPanel("freeMoments")}
          requestInProgress={freeTimeRequestInProgress}
          status={freeTime}
        />

        <LiveSessionPanel
          draft={liveSessionDraft}
          error={liveSessionError}
          expanded={controlPanels.liveSession}
          loading={liveSessionLoading}
          onAction={runLiveSessionAction}
          onDraftChange={setLiveSessionDraft}
          onToggle={() => toggleControlPanel("liveSession")}
          onToggleAgent={toggleLiveSessionAgent}
          requestInProgress={liveSessionRequestInProgress}
          status={liveSession}
        />

        <LaunchpadPanel
          draft={launchpadDraft}
          error={launchpadError}
          expanded={controlPanels.launchpad}
          loading={launchpadLoading}
          onAction={runLaunchpadAction}
          onDraftChange={setLaunchpadDraft}
          onToggle={() => toggleControlPanel("launchpad")}
          preview={launchpadPreview}
          requestInProgress={launchpadRequestInProgress}
          status={launchpad}
        />

        <WakeControlPanel
          error={wakeControlPolicyError}
          expanded={controlPanels.wake}
          loading={wakeControlPolicyLoading}
          onRefresh={loadWakeControlPolicy}
          onToggle={() => toggleControlPanel("wake")}
          onToggleAgent={toggleWakeAgent}
          onToggleMention={toggleWakeMention}
          onToggleTrigger={toggleWakeTrigger}
          policy={wakeControlPolicy}
          saving={wakeControlPolicySaving}
        />

        <WorkPacketSignalsPanel
          error={workPacketSignalsError}
          expanded={controlPanels.packetSignals}
          loading={workPacketSignalsLoading}
          noteWakeError={operatorNoteWakesError}
          noteWakeLoading={operatorNoteWakesLoading}
          noteWakeRequestInProgress={operatorNoteWakesRequestInProgress}
          noteWakeStatus={operatorNoteWakes}
          onAction={runWorkPacketSignalsAction}
          onNoteWakeAction={runOperatorNoteWakesAction}
          onPreview={previewWorkPacketSignals}
          onToggle={() => toggleControlPanel("packetSignals")}
          preview={workPacketSignalPreview}
          requestInProgress={workPacketSignalsRequestInProgress}
          selectedAgent={selectedAgent}
          status={workPacketSignals}
        />
      </aside>

      {activeSurface === "cafe" ? (
        <CafeView
          cafe={cafe}
          error={cafeError}
          loading={cafeLoading}
          message={cafeMessage}
          onAddFiles={addCafeFiles}
          onMessageChange={setCafeMessage}
          onRemoveAttachment={removeCafeAttachment}
          onRefresh={loadCafe}
          onSubmit={sendCafeMessage}
          pendingAttachments={cafePendingAttachments}
          sending={cafeSending}
        />
      ) : activeSurface === "bar" ? (
        <BarView
          bar={bar}
          error={barError}
          loading={barLoading}
          message={barMessage}
          onAddFiles={addBarFiles}
          onMessageChange={setBarMessage}
          onRemoveAttachment={removeBarAttachment}
          onRefresh={loadBar}
          onSubmit={sendBarMessage}
          pendingAttachments={barPendingAttachments}
          sending={barSending}
        />
      ) : activeSurface === "eyes" ? (
        <EyesView
          error={eyesError}
          eyes={eyes}
          loading={eyesLoading}
          message={eyesMessage}
          onAddFrames={addEyesFrames}
          onMessageChange={setEyesMessage}
          onRefresh={loadEyes}
          onRemoveFrame={removeEyesFrame}
          onSubmit={sendEyesMessage}
          pendingFrames={eyesPendingFrames}
          sending={eyesSending}
        />
      ) : activeSurface === "inbox" ? (
        <OperatorInboxView
          actionInProgress={operatorInboxActionInProgress}
          error={operatorInboxError}
          loading={operatorInboxLoading}
          notes={operatorInboxNotes}
          operatorNoteDraft={operatorNoteDraft}
          operatorNoteDetails={operatorNoteDetails}
          operatorNoteExpanded={operatorNoteExpanded}
          operatorNotes={operatorInboxOperatorNotes}
          operatorReplies={operatorNoteReplies}
          operatorNoteTrailErrors={operatorNoteTrailErrors}
          operatorNoteTrailLoading={operatorNoteTrailLoading}
          onCreateOperatorNote={createOperatorNote}
          onOperatorDraftChange={setOperatorNoteDraft}
          onOperatorNoteAction={updateOperatorNote}
          onOperatorReplyChange={(noteId, reply) =>
            setOperatorNoteReplies((current) => ({ ...current, [noteId]: reply }))
          }
          onOperatorNoteTrailToggle={toggleOperatorNoteTrail}
          onNoteChange={(packetId, note) =>
            setOperatorInboxNotes((current) => ({ ...current, [packetId]: note }))
          }
          onRefresh={loadOperatorInbox}
          onReview={reviewOperatorRollup}
          packets={pendingOperatorRollups}
        />
      ) : (
      <section className="main">
        <header className="header">
          <h2>{activeAgent?.display_name ?? selectedAgent}</h2>
          <p>{conversationLabel(selectedAgent)}</p>
        </header>

        <form
          className="composer"
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            addFiles(event.dataTransfer.files);
          }}
          onSubmit={sendMessage}
        >
          {error ? <p className="error">{error}</p> : null}
          <div className="composer-row">
            <textarea
              disabled={loading || sending || agents.length === 0}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={`Message ${activeAgent?.display_name ?? selectedAgent}`}
              value={message}
            />
            <div className="composer-actions">
              <input
                multiple
                onChange={(event) => {
                  if (event.target.files) {
                    addFiles(event.target.files);
                  }
                  event.target.value = "";
                }}
                ref={fileInputRef}
                type="file"
              />
              <button
                className="attach"
                disabled={loading || sending || agents.length === 0}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                Attach
              </button>
              <button
                className="send"
                disabled={loading || sending || (!message.trim() && pendingAttachments.length === 0)}
                type="submit"
              >
                {sending ? "Sending" : "Send"}
              </button>
            </div>
          </div>
          {pendingAttachments.length ? (
            <div className="attachment-tray" aria-label="Pending attachments">
              {pendingAttachments.map((attachment) => (
                <span className={`attachment-chip ${attachment.status}`} key={attachment.localId}>
                  <span>
                    {attachment.file.name}
                    <small>{formatBytes(attachment.file.size)} · {attachment.status}</small>
                    {attachment.error ? <small className="attachment-error">{attachment.error}</small> : null}
                  </span>
                  <button
                    disabled={sending}
                    onClick={() => removeAttachment(attachment.localId)}
                    type="button"
                    aria-label={`Remove ${attachment.file.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </form>

        {compactionCompile ? (
          <section className="proposal-panel" aria-label="Room note">
            <div className="proposal-header">
              <div>
                <h3>Room Note</h3>
                <p>
                  {compactionCompile.saved_proposal_id
                    ? savedProposalLabel(compactionCompile)
                    : `${compactionCompile.source?.selected_message_count ?? 0} messages selected${
                        compactionCompile.source?.bounded
                          ? `, ${compactionCompile.source.omitted_message_count} omitted by budget`
                          : ", none omitted"
                      }`}
                </p>
              </div>
              <button type="button" onClick={() => setCompactionCompile(null)}>
                Close
              </button>
            </div>
            <p className="proposal-note">
              No messages changed yet. Edit this note after Agent/Operator review, then send housekeeping.
              {compactionCompile.agent_notes ? ` Agent notes: ${compactionCompile.agent_notes}` : ""}
            </p>
            <textarea
              className="proposal-draft"
              onChange={(event) => setCheckpointDraft(event.target.value)}
              value={checkpointDraft}
            />
            <div className="proposal-actions">
              <button
                className="checkpoint-action"
                disabled={checkpointLoading || !checkpointDraft.trim()}
                onClick={createCompactionCheckpoint}
                type="button"
              >
                {checkpointLoading ? "Sending" : "Send Housekeeping"}
              </button>
              <span>Append-only. Raw messages stay in Supabase.</span>
            </div>
            {checkpointError ? <p className="error">{checkpointError}</p> : null}
            {checkpointReceipt ? (
              <p className="proposal-receipt">
                Room refreshed at position {checkpointReceipt.checkpoint.position}. Active
                pressure now starts after this marker.
              </p>
            ) : null}
          </section>
        ) : null}

        <div className="transcript" ref={transcriptRef}>
          {loading ? <p className="empty">Loading seeded context...</p> : null}

          {!loading && activeMessages.length === 0 ? (
            <p className="empty">
              No messages yet. Send the first note and the server will wake this agent with their seeded context.
            </p>
          ) : null}

          {hiddenOlderMessageCount > 0 ? (
            <p className="transcript-window-note">
              Showing latest {activeMessages.length.toLocaleString()} of{" "}
              {activeMessageCount.toLocaleString()} active messages. Older messages remain in
              Supabase.
            </p>
          ) : null}

          {displayMessages.map((chatMessage) => {
            const messageToolEvents =
              chatMessage.role === "assistant" && chatMessage.turn_id
                ? toolEventsByTurn.get(chatMessage.turn_id) ?? []
                : [];
            const messageAttachments = attachmentsFromContent(chatMessage.content);

            return (
              <article
                className={`message ${chatMessage.role}`}
                key={chatMessage.id ?? `${chatMessage.conversation_id}-${chatMessage.position}`}
              >
                <div className="message-meta">
                  <span>
                    {chatMessage.role === "assistant"
                      ? activeAgent?.display_name ?? selectedAgent
                      : "Chris"}
                  </span>
                  {chatMessage.created_at ? (
                    <time dateTime={chatMessage.created_at}>{formatMessageTime(chatMessage.created_at)}</time>
                  ) : null}
                </div>
                <div>{textFromContent(chatMessage.content)}</div>
                {messageAttachments.length > 0 ? (
                  <div className="message-attachments" aria-label="Message attachments">
                    {messageAttachments.map((attachment) => (
                      <span className="message-attachment" key={attachment.id}>
                        {attachment.title}
                        <small>
                          {attachment.material_type} · {formatBytes(attachment.size_bytes)}
                          {attachment.readable_as_text ? " · text-readable" : ""}
                        </small>
                      </span>
                    ))}
                  </div>
                ) : null}
                {messageToolEvents.length > 0 ? (
                  <div className="tool-audit" aria-label="Tool calls for this turn">
                    <span>Tools</span>
                    {messageToolEvents.map((event, index) => (
                      <span
                        className={`tool-pill ${event.ok ? "ok" : "error"}`}
                        key={
                          event.id ??
                          `${event.turn_id}-${event.round}-${event.tool_name}-${index}`
                        }
                        title={event.result_preview ?? undefined}
                      >
                        {event.tool_name}
                        {event.ok ? "" : " failed"}
                        {event.result_chars ? ` · ${event.result_chars.toLocaleString()} chars` : ""}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
      )}
    </main>
  );
}

function CafeView({
  cafe,
  error,
  loading,
  message,
  onAddFiles,
  onMessageChange,
  onRemoveAttachment,
  onRefresh,
  onSubmit,
  pendingAttachments,
  sending
}: {
  cafe: CafeState | null;
  error: string;
  loading: boolean;
  message: string;
  onAddFiles: (files: FileList | File[]) => void;
  onMessageChange: (message: string) => void;
  onRemoveAttachment: (localId: string) => void;
  onRefresh: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pendingAttachments: PendingAttachment[];
  sending: boolean;
}) {
  const cafeFileInputRef = useRef<HTMLInputElement | null>(null);
  const participants = cafe?.participants ?? [];
  const messages = cafe?.messages ?? [];

  return (
    <section className="main">
      <header className="header cafe-header">
        <h2 className="visually-hidden">{cafe?.room.title ?? "Cafe"}</h2>
        <div className="cafe-participants" aria-label="Cafe participants">
          {participants.length ? (
            participants.map((participant) => (
              <span className="participant-chip" key={participant.id}>
                <strong>{participant.display_name}</strong>
                <small>{participantAdapterLabel(participant)}</small>
              </span>
            ))
          ) : (
            <span className="participant-chip muted">No participants loaded</span>
          )}
        </div>
        <button className="quiet-action" disabled={loading || sending} onClick={onRefresh} type="button">
          Refresh
        </button>
      </header>

      <form
        className="composer cafe-composer"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          onAddFiles(event.dataTransfer.files);
        }}
        onSubmit={onSubmit}
      >
        {error ? <p className="error">{error}</p> : null}
        <div className="composer-row">
          <textarea
            disabled={loading || sending}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Message the Cafe"
            value={message}
          />
          <div className="composer-actions">
            <input
              multiple
              onChange={(event) => {
                if (event.target.files) {
                  onAddFiles(event.target.files);
                }
                event.target.value = "";
              }}
              ref={cafeFileInputRef}
              type="file"
            />
            <button
              className="attach"
              disabled={loading || sending}
              onClick={() => cafeFileInputRef.current?.click()}
              type="button"
            >
              Attach
            </button>
            <button
              className="send"
              disabled={loading || sending || (!message.trim() && pendingAttachments.length === 0)}
              type="submit"
            >
              {sending ? "Posting" : "Post"}
            </button>
          </div>
        </div>
        {pendingAttachments.length ? (
          <div className="attachment-tray" aria-label="Pending Cafe attachments">
            {pendingAttachments.map((attachment) => (
              <span className={`attachment-chip ${attachment.status}`} key={attachment.localId}>
                <span>
                  {attachment.file.name}
                  <small>{formatBytes(attachment.file.size)} · {attachment.status}</small>
                  {attachment.error ? <small className="attachment-error">{attachment.error}</small> : null}
                </span>
                <button
                  aria-label={`Remove ${attachment.file.name}`}
                  disabled={sending}
                  onClick={() => onRemoveAttachment(attachment.localId)}
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </form>

      <div className="transcript cafe-transcript">
        {loading ? <p className="empty">Loading Cafe...</p> : null}
        {!loading && !messages.length ? (
          <p className="empty">No Cafe messages yet. Say something and the room exists.</p>
        ) : null}
        {messages.map((cafeMessage) => {
          const messageAttachments = attachmentsFromCafeMetadata(cafeMessage.metadata);

          return (
            <article
              className={`message ${cafeMessage.author_type === "operator" ? "user" : "assistant"}`}
              key={cafeMessage.id}
            >
              <div className="message-meta">
                <span>{cafeMessage.author_display_name}</span>
                <time dateTime={cafeMessage.created_at}>{formatMessageTime(cafeMessage.created_at)}</time>
              </div>
              <div>{cafeMessage.content}</div>
              {messageAttachments.length > 0 ? (
                <div className="message-attachments" aria-label="Cafe message attachments">
                  {messageAttachments.map((attachment) => (
                    <span className="message-attachment" key={attachment.id}>
                      {attachment.title}
                      <small>
                        {attachment.material_type} · {formatBytes(attachment.size_bytes)}
                        {attachment.readable_as_text ? " · text-readable" : ""}
                      </small>
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function BarView({
  bar,
  error,
  loading,
  message,
  onAddFiles,
  onMessageChange,
  onRemoveAttachment,
  onRefresh,
  onSubmit,
  pendingAttachments,
  sending
}: {
  bar: BarState | null;
  error: string;
  loading: boolean;
  message: string;
  onAddFiles: (files: FileList | File[]) => void;
  onMessageChange: (message: string) => void;
  onRemoveAttachment: (localId: string) => void;
  onRefresh: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pendingAttachments: PendingAttachment[];
  sending: boolean;
}) {
  const barFileInputRef = useRef<HTMLInputElement | null>(null);
  const presence = bar?.presence ?? [];
  const messages = bar?.messages ?? [];

  return (
    <section className="main bar-main">
      <header className="header cafe-header bar-header">
        <h2 className="visually-hidden">{bar?.room.title ?? "BAR"}</h2>
        <div className="cafe-participants" aria-label="BAR participants">
          {presence.length ? (
            presence.map((receipt) => (
              <span className={`participant-chip ${receipt.state}`} key={receipt.id}>
                <strong>{receipt.display_name}</strong>
                <small>{presenceStateLabel(receipt.state)}</small>
              </span>
            ))
          ) : (
            <span className="participant-chip muted">No participants loaded</span>
          )}
        </div>
        <button className="quiet-action" disabled={loading || sending} onClick={onRefresh} type="button">
          Refresh
        </button>
      </header>

      <form
        className="composer cafe-composer bar-composer"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          onAddFiles(event.dataTransfer.files);
        }}
        onSubmit={onSubmit}
      >
        {error ? <p className="error">{error}</p> : null}
        <div className="composer-row">
          <textarea
            disabled={loading || sending}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Message BAR"
            value={message}
          />
          <div className="composer-actions">
            <input
              multiple
              onChange={(event) => {
                if (event.target.files) {
                  onAddFiles(event.target.files);
                }
                event.target.value = "";
              }}
              ref={barFileInputRef}
              type="file"
            />
            <button
              className="attach"
              disabled={loading || sending}
              onClick={() => barFileInputRef.current?.click()}
              type="button"
            >
              Attach
            </button>
            <button
              className="send"
              disabled={loading || sending || (!message.trim() && pendingAttachments.length === 0)}
              type="submit"
            >
              {sending ? "Posting" : "Post"}
            </button>
          </div>
        </div>
        {pendingAttachments.length ? (
          <div className="attachment-tray" aria-label="Pending BAR attachments">
            {pendingAttachments.map((attachment) => (
              <span className={`attachment-chip ${attachment.status}`} key={attachment.localId}>
                <span>
                  {attachment.file.name}
                  <small>{formatBytes(attachment.file.size)} · {attachment.status}</small>
                  {attachment.error ? <small className="attachment-error">{attachment.error}</small> : null}
                </span>
                <button
                  aria-label={`Remove ${attachment.file.name}`}
                  disabled={sending}
                  onClick={() => onRemoveAttachment(attachment.localId)}
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </form>

      <div className="transcript cafe-transcript bar-transcript">
        {loading ? <p className="empty">Loading BAR...</p> : null}
        {!loading && !messages.length ? (
          <p className="empty">No BAR messages yet.</p>
        ) : null}
        {messages.map((barMessage) => {
          const messageAttachments = attachmentsFromCafeMetadata(barMessage.metadata);

          return (
            <article
              className={`message ${barMessage.author_type === "operator" ? "user" : "assistant"}`}
              key={barMessage.id}
            >
              <div className="message-meta">
                <span>{barMessage.author_display_name}</span>
                <time dateTime={barMessage.created_at}>{formatMessageTime(barMessage.created_at)}</time>
              </div>
              <div>{barMessage.content}</div>
              {messageAttachments.length > 0 ? (
                <div className="message-attachments" aria-label="BAR message attachments">
                  {messageAttachments.map((attachment) => (
                    <span className="message-attachment" key={attachment.id}>
                      {attachment.title}
                      <small>
                        {attachment.material_type} · {formatBytes(attachment.size_bytes)}
                        {attachment.readable_as_text ? " · text-readable" : ""}
                      </small>
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EyesView({
  error,
  eyes,
  loading,
  message,
  onAddFrames,
  onMessageChange,
  onRefresh,
  onRemoveFrame,
  onSubmit,
  pendingFrames,
  sending
}: {
  error: string;
  eyes: EyesState | null;
  loading: boolean;
  message: string;
  onAddFrames: (files: FileList | File[]) => void;
  onMessageChange: (message: string) => void;
  onRefresh: () => void;
  onRemoveFrame: (localId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pendingFrames: PendingAttachment[];
  sending: boolean;
}) {
  const eyesFileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<"idle" | "starting" | "live" | "unavailable">("idle");
  const presence = eyes?.presence ?? [];
  const messages = eyes?.messages ?? [];
  const frames = eyes?.frames ?? [];

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function startCamera() {
    if (cameraState === "starting" || cameraState === "live") {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("unavailable");
      return;
    }

    setCameraState("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 960 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraState("live");
    } catch {
      setCameraState("unavailable");
    }
  }

  async function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || cameraState !== "live") {
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 960;
    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.86);
    });

    if (!blob) {
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    onAddFrames([new File([blob], `eyes-frame-${stamp}.jpg`, { type: "image/jpeg" })]);
  }

  return (
    <section className="main bar-main eyes-main">
      <header className="header cafe-header bar-header">
        <h2 className="visually-hidden">{eyes?.room.title ?? "EYES"}</h2>
        <div className="cafe-participants" aria-label="EYES participants">
          {presence.length ? (
            presence.map((receipt) => (
              <span className={`participant-chip ${receipt.state}`} key={receipt.id}>
                <strong>{receipt.display_name}</strong>
                <small>{presenceStateLabel(receipt.state)}</small>
              </span>
            ))
          ) : (
            <span className="participant-chip muted">No observers loaded</span>
          )}
        </div>
        <button className="quiet-action" disabled={loading || sending} onClick={onRefresh} type="button">
          Refresh
        </button>
      </header>

      <div className="eyes-viewfinder">
        <div className={`eyes-camera-frame ${cameraState}`}>
          <video autoPlay muted playsInline ref={videoRef} />
          {cameraState === "idle" ? <span>Camera idle</span> : null}
          {cameraState === "starting" ? <span>Starting camera...</span> : null}
          {cameraState === "unavailable" ? <span>Camera unavailable</span> : null}
        </div>
        <canvas ref={canvasRef} />
        <div className="eyes-controls">
          <button disabled={sending || cameraState === "starting"} onClick={startCamera} type="button">
            {cameraState === "live" ? "Camera live" : "Start camera"}
          </button>
          <button disabled={sending || cameraState !== "live"} onClick={captureFrame} type="button">
            Capture frame
          </button>
          <button disabled={loading || sending} onClick={() => eyesFileInputRef.current?.click()} type="button">
            Attach frame
          </button>
        </div>
        {frames.length ? (
          <div className="eyes-latest" aria-label="Latest EYES frames">
            <strong>Latest frames</strong>
            {frames.map((frame) => (
              <span key={`${frame.id}-${frame.sequence}`}>
                {frame.title}
                <small>{formatMessageTime(frame.captured_at)}</small>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <form
        className="composer cafe-composer bar-composer eyes-composer"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          onAddFrames(event.dataTransfer.files);
        }}
        onSubmit={onSubmit}
      >
        {error ? <p className="error">{error}</p> : null}
        <div className="composer-row">
          <textarea
            disabled={loading || sending}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Message EYES or describe this frame"
            value={message}
          />
          <div className="composer-actions">
            <input
              accept="image/*"
              multiple
              onChange={(event) => {
                if (event.target.files) {
                  onAddFrames(event.target.files);
                }
                event.target.value = "";
              }}
              ref={eyesFileInputRef}
              type="file"
            />
            <button
              className="send"
              disabled={loading || sending || (!message.trim() && pendingFrames.length === 0)}
              type="submit"
            >
              {sending ? "Posting" : pendingFrames.length ? "Share" : "Post"}
            </button>
          </div>
        </div>
        {pendingFrames.length ? (
          <div className="attachment-tray" aria-label="Pending EYES frames">
            {pendingFrames.map((frame) => (
              <span className={`attachment-chip ${frame.status}`} key={frame.localId}>
                <span>
                  {frame.file.name}
                  <small>{formatBytes(frame.file.size)} · {frame.status}</small>
                  {frame.error ? <small className="attachment-error">{frame.error}</small> : null}
                </span>
                <button
                  aria-label={`Remove ${frame.file.name}`}
                  disabled={sending}
                  onClick={() => onRemoveFrame(frame.localId)}
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </form>

      <div className="transcript cafe-transcript bar-transcript">
        {loading ? <p className="empty">Loading EYES...</p> : null}
        {!loading && !messages.length ? (
          <p className="empty">No EYES observations yet.</p>
        ) : null}
        {messages.map((eyesMessage) => {
          const messageFrames = framesFromEyesMetadata(eyesMessage.metadata);

          return (
            <article
              className={`message ${eyesMessage.author_type === "operator" ? "user" : "assistant"}`}
              key={eyesMessage.id}
            >
              <div className="message-meta">
                <span>{eyesMessage.author_display_name}</span>
                <time dateTime={eyesMessage.created_at}>{formatMessageTime(eyesMessage.created_at)}</time>
              </div>
              <div>{eyesMessage.content}</div>
              {messageFrames.length > 0 ? (
                <div className="message-attachments" aria-label="EYES message frames">
                  {messageFrames.map((frame) => (
                    <span className="message-attachment" key={frame.id}>
                      {frame.title}
                      <small>
                        {frame.material_type} · {formatBytes(frame.size_bytes)}
                      </small>
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OperatorInboxView({
  actionInProgress,
  error,
  loading,
  notes,
  onNoteChange,
  onCreateOperatorNote,
  onOperatorDraftChange,
  onOperatorNoteAction,
  onOperatorReplyChange,
  onOperatorNoteTrailToggle,
  onRefresh,
  onReview,
  operatorNoteDraft,
  operatorNoteDetails,
  operatorNoteExpanded,
  operatorNotes,
  operatorReplies,
  operatorNoteTrailErrors,
  operatorNoteTrailLoading,
  packets
}: {
  actionInProgress: string | null;
  error: string;
  loading: boolean;
  notes: Record<string, string>;
  onNoteChange: (packetId: string, note: string) => void;
  onCreateOperatorNote: () => void;
  onOperatorDraftChange: (draft: { agent: OperatorNoteRecipient; subject: string; body: string }) => void;
  onOperatorNoteAction: (
    noteId: string,
    action: "reply" | "mark_read" | "archive",
    body?: string
  ) => void;
  onOperatorReplyChange: (noteId: string, reply: string) => void;
  onOperatorNoteTrailToggle: (noteId: string) => void;
  onRefresh: () => void;
  onReview: (packetId: string, reviewState: "approved" | "request_changes" | "hold") => void;
  operatorNoteDraft: { agent: OperatorNoteRecipient; subject: string; body: string };
  operatorNoteDetails: Record<string, OperatorNoteDetail>;
  operatorNoteExpanded: Record<string, boolean>;
  operatorNotes: OperatorNote[];
  operatorReplies: Record<string, string>;
  operatorNoteTrailErrors: Record<string, string>;
  operatorNoteTrailLoading: Record<string, boolean>;
  packets: WorkPacket[];
}) {
  const actionDisabled = Boolean(actionInProgress);
  const [operatorNoteFilter, setOperatorNoteFilter] = useState<OperatorNoteFilter>("active");
  const filteredOperatorNotes = operatorNotes.filter((note) =>
    operatorNoteMatchesFilter(note, operatorNoteFilter)
  );
  const operatorNoteFilterCounts = {
    active: operatorNotes.filter((note) => operatorNoteMatchesFilter(note, "active")).length,
    needs_operator: operatorNotes.filter((note) =>
      operatorNoteMatchesFilter(note, "needs_operator")
    ).length,
    waiting_agent: operatorNotes.filter((note) => operatorNoteMatchesFilter(note, "waiting_agent")).length,
    settled: operatorNotes.filter((note) => operatorNoteMatchesFilter(note, "settled")).length,
    all: operatorNotes.length
  };
  const operatorNoteFilterOptions: Array<{ label: string; value: OperatorNoteFilter }> = [
    { label: "Active", value: "active" },
    { label: "Needs Chris", value: "needs_operator" },
    { label: "Waiting", value: "waiting_agent" },
    { label: "Settled", value: "settled" },
    { label: "All", value: "all" }
  ];

  return (
    <section className="main inbox-main">
      <header className="header inbox-header">
        <div>
          <h2>Operator Inbox</h2>
          <p>Asynchronous notes and rollups awaiting review. Source trails stay attached.</p>
        </div>
        <button className="quiet-action" disabled={loading || Boolean(actionInProgress)} onClick={onRefresh} type="button">
          Refresh
        </button>
      </header>

      <div className="inbox-list">
        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="empty">Loading Operator Inbox...</p> : null}
        {!loading && !operatorNotes.length && !packets.length ? (
          <p className="empty">No Operator notes or rollups are waiting.</p>
        ) : null}

        <section className="inbox-section" aria-label="New Operator Note">
          <div className="inbox-section-heading">
            <div>
              <p className="inbox-eyebrow">New Operator Note</p>
              <h3>Leave a note</h3>
            </div>
          </div>

          <article className="inbox-card operator-note-composer">
            <div className="operator-note-fields">
              <label>
                <span>Recipient</span>
                <select
                  disabled={actionDisabled}
                  onChange={(event) =>
                    onOperatorDraftChange({
                      ...operatorNoteDraft,
                      agent: event.target.value as OperatorNoteRecipient
                    })
                  }
                  value={operatorNoteDraft.agent}
                >
                  <option value="all">Everyone</option>
                  <option value="soren">Soren</option>
                  <option value="varro">Varro</option>
                  <option value="julian">Julian</option>
                  <option value="cael">Cael</option>
                </select>
              </label>
              <label>
                <span>Subject</span>
                <input
                  disabled={actionDisabled}
                  onChange={(event) =>
                    onOperatorDraftChange({
                      ...operatorNoteDraft,
                      subject: event.target.value
                    })
                  }
                  placeholder="Optional"
                  value={operatorNoteDraft.subject}
                />
              </label>
            </div>

            <label className="inbox-note">
              <span>Note</span>
              <textarea
                disabled={actionDisabled}
                onChange={(event) =>
                  onOperatorDraftChange({
                    ...operatorNoteDraft,
                    body: event.target.value
                  })
                }
                placeholder="Leave an asynchronous note"
                value={operatorNoteDraft.body}
              />
            </label>

            <div className="inbox-actions">
              <button
                className="checkpoint-action"
                disabled={actionDisabled || !operatorNoteDraft.body.trim()}
                onClick={onCreateOperatorNote}
                type="button"
              >
                {actionInProgress === "operator-note:create" ? "Sending" : "Send Note"}
              </button>
            </div>
          </article>
        </section>

        {!loading && operatorNotes.length ? (
          <section className="inbox-section" aria-label="Operator Notes">
            <div className="inbox-section-heading">
              <div>
                <p className="inbox-eyebrow">Operator Notes</p>
                <h3>Notes</h3>
              </div>
              <span>
                {filteredOperatorNotes.length} / {operatorNotes.length}
              </span>
            </div>

            <div className="operator-note-filter" aria-label="Filter Operator Notes">
              {operatorNoteFilterOptions.map((option) => (
                <button
                  className={operatorNoteFilter === option.value ? "active" : ""}
                  key={option.value}
                  onClick={() => setOperatorNoteFilter(option.value)}
                  type="button"
                >
                  <span>{option.label}</span>
                  <strong>{operatorNoteFilterCounts[option.value]}</strong>
                </button>
              ))}
            </div>

            {!filteredOperatorNotes.length ? (
              <p className="empty">No Operator notes match this filter.</p>
            ) : null}

            {filteredOperatorNotes.map((operatorNote) => {
              const reply = operatorReplies[operatorNote.id] ?? "";
              const isUnread = operatorNote.operator_status === "unread";
              const agentLabel = participantDisplayName(`agent:${operatorNote.agent}`);
              const isTrailExpanded = Boolean(operatorNoteExpanded[operatorNote.id]);
              const trailDetail = operatorNoteDetails[operatorNote.id];
              const trailError = operatorNoteTrailErrors[operatorNote.id];
              const trailLoading = Boolean(operatorNoteTrailLoading[operatorNote.id]);
              const latestEventLabel =
                operatorNote.latest_event?.event_type === "reply" ? "Latest reply" : "Original note";

              return (
                <article className={`inbox-card operator-note-card ${isUnread ? "unread" : ""}`} key={operatorNote.id}>
                  <div className="inbox-card-header">
                    <div>
                      <p className="inbox-eyebrow">Operator Note</p>
                      <h3>{operatorNote.subject || "Untitled note"}</h3>
                      <p>
                        {agentLabel} · Last message {actorDisplayName(operatorNote.last_message_by)} · Updated{" "}
                        {formatMessageTime(operatorNote.updated_at)}
                      </p>
                    </div>
                    <div className="inbox-status-stack">
                      <span className={`inbox-status ${isUnread ? "unread" : ""}`}>
                        {operatorNoteAttentionLabel(operatorNote)}
                      </span>
                      <span className={`inbox-status subtle ${operatorNote.agent_status === "unread" ? "unread" : ""}`}>
                        {agentLabel} {operatorNote.agent_status}
                      </span>
                    </div>
                  </div>

                  <div className="operator-note-preview">
                    <span>{latestEventLabel}</span>
                    <p>{operatorNote.latest_event?.content || "No note body available."}</p>
                  </div>

                  {isTrailExpanded ? (
                    <OperatorNoteTrail
                      error={trailError}
                      events={trailDetail?.events ?? []}
                      loading={trailLoading}
                    />
                  ) : null}

                  <label className="inbox-note">
                    <span>Reply</span>
                    <textarea
                      disabled={actionDisabled}
                      onChange={(event) => onOperatorReplyChange(operatorNote.id, event.target.value)}
                      placeholder="Optional reply for the note trail"
                      value={reply}
                    />
                  </label>

                  <div className="inbox-actions">
                    <button
                      className="quiet-action"
                      disabled={actionDisabled}
                      onClick={() => onOperatorNoteTrailToggle(operatorNote.id)}
                      type="button"
                    >
                      {isTrailExpanded ? "Hide Trail" : "Trail"}
                    </button>
                    <button
                      className="checkpoint-action"
                      disabled={actionDisabled || !reply.trim()}
                      onClick={() => onOperatorNoteAction(operatorNote.id, "reply", reply)}
                      type="button"
                    >
                      {actionInProgress === `${operatorNote.id}:reply` ? "Replying" : "Reply"}
                    </button>
                    <button
                      className="quiet-action"
                      disabled={actionDisabled || !isUnread}
                      onClick={() => onOperatorNoteAction(operatorNote.id, "mark_read")}
                      type="button"
                    >
                      Mark Read
                    </button>
                    <button
                      className="quiet-action"
                      disabled={actionDisabled}
                      onClick={() => onOperatorNoteAction(operatorNote.id, "archive")}
                      type="button"
                    >
                      Archive
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}

        {!loading && packets.length ? (
          <section className="inbox-section" aria-label="Work Packet Rollups">
            <div className="inbox-section-heading">
              <div>
                <p className="inbox-eyebrow">Work Packets</p>
                <h3>Rollups</h3>
              </div>
              <span>{packets.length}</span>
            </div>

            {packets.map((packet) => {
          const rollup = packet.review_rollup ?? {};
          const evidenceHandles = githubEvidenceHandlesFromMetadata(packet.metadata);
          const note = notes[packet.id] ?? "";

          return (
            <article className="inbox-card" key={packet.id}>
              <div className="inbox-card-header">
                <div>
                  <p className="inbox-eyebrow">Work Packet Rollup</p>
                  <h3>{packet.title}</h3>
                  <p>
                    Conductor {participantDisplayName(packet.conductor)} · Updated{" "}
                    {formatMessageTime(packet.updated_at)}
                  </p>
                </div>
                <span className="inbox-status">Review</span>
              </div>

              <div className="inbox-rollup">
                <div>
                  <h4>Summary</h4>
                  <p>{rollup.summary || "No summary provided."}</p>
                </div>
                {rollup.decision_needed ? (
                  <div>
                    <h4>Decision Needed</h4>
                    <p>{rollup.decision_needed}</p>
                  </div>
                ) : null}
                {rollup.next_step ? (
                  <div>
                    <h4>Next Step</h4>
                    <p>{rollup.next_step}</p>
                  </div>
                ) : null}
              </div>

              <GitHubEvidenceList handles={evidenceHandles} />

              <div className="inbox-rollup-grid">
                <RollupList title="Reviewed By" items={rollup.reviewed_by} />
                <RollupList title="Aligned" items={rollup.aligned} />
                <RollupList title="Open / Blocked" items={[...(rollup.disagreed ?? []), ...(rollup.blocked ?? [])]} />
              </div>

              <label className="inbox-note">
                <span>Operator note</span>
                <textarea
                  disabled={actionDisabled}
                  onChange={(event) => onNoteChange(packet.id, event.target.value)}
                  placeholder="Optional note for the packet trail"
                  value={note}
                />
              </label>

              <div className="inbox-actions">
                <button
                  className="checkpoint-action"
                  disabled={actionDisabled}
                  onClick={() => onReview(packet.id, "approved")}
                  type="button"
                >
                  {actionInProgress === `${packet.id}:approved` ? "Approving" : "Approve"}
                </button>
                <button
                  className="quiet-action"
                  disabled={actionDisabled}
                  onClick={() => onReview(packet.id, "request_changes")}
                  type="button"
                >
                  Request Changes
                </button>
                <button
                  className="quiet-action"
                  disabled={actionDisabled}
                  onClick={() => onReview(packet.id, "hold")}
                  type="button"
                >
                  Hold
                </button>
              </div>
            </article>
          );
        })}
          </section>
        ) : null}
      </div>
    </section>
  );
}

function OperatorNoteTrail({
  error,
  events,
  loading
}: {
  error?: string;
  events: OperatorNoteEvent[];
  loading: boolean;
}) {
  return (
    <div className="operator-note-trail" aria-label="Operator note trail">
      <div className="operator-note-trail-header">
        <h4>Trail</h4>
        <span>{loading ? "Loading" : `${events.length} ${events.length === 1 ? "event" : "events"}`}</span>
      </div>
      {error ? <p className="operator-note-trail-error">{error}</p> : null}
      {!error && loading ? <p className="operator-note-trail-empty">Loading note trail...</p> : null}
      {!error && !loading && !events.length ? (
        <p className="operator-note-trail-empty">No trail events found.</p>
      ) : null}
      {!error && events.length ? (
        <ol>
          {events.map((event) => (
            <li className="operator-note-event" key={event.id}>
              <div className="operator-note-event-meta">
                <span>{actorDisplayName(event.actor_id)}</span>
                <span>{operatorNoteEventLabel(event.event_type)}</span>
                <time dateTime={event.created_at}>{formatMessageTime(event.created_at)}</time>
              </div>
              <p>{event.content}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function GitHubEvidenceList({ handles }: { handles: GitHubEvidenceHandle[] }) {
  if (!handles.length) {
    return null;
  }

  return (
    <div className="github-evidence" aria-label="GitHub evidence handles">
      <div>
        <h4>Evidence</h4>
        <p>Authorized GitHub file handles for this packet. No content is fetched here.</p>
      </div>
      <div className="github-evidence-list">
        {handles.map((handle) => {
          const refNotice = githubRefNotice(handle.ref);

          return (
            <article className="github-evidence-card" key={handle.id}>
              <div>
                <strong>{handle.citation_label}</strong>
                <code>
                  {handle.owner}/{handle.repo}:{handle.path}
                </code>
              </div>
              <dl>
                <div>
                  <dt>Handle</dt>
                  <dd>{handle.id}</dd>
                </div>
                <div>
                  <dt>Ref</dt>
                  <dd>{handle.ref}</dd>
                </div>
                <div>
                  <dt>Purpose</dt>
                  <dd>{handle.purpose}</dd>
                </div>
                <div>
                  <dt>Authorized By</dt>
                  <dd>{participantDisplayName(handle.authored_by)}</dd>
                </div>
                {handle.max_bytes ? (
                  <div>
                    <dt>Max Bytes</dt>
                    <dd>{handle.max_bytes.toLocaleString()}</dd>
                  </div>
                ) : null}
              </dl>
              {refNotice ? <p className="github-evidence-warning">{refNotice}</p> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function RollupList({ items, title }: { items?: string[]; title: string }) {
  const visibleItems = (items ?? []).filter(Boolean);

  return (
    <div className="rollup-list">
      <h4>{title}</h4>
      {visibleItems.length ? (
        <ul>
          {visibleItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>None noted.</p>
      )}
    </div>
  );
}

function githubEvidenceHandlesFromMetadata(metadata: Record<string, unknown> | null | undefined) {
  const evidence = metadata?.github_evidence;

  if (!Array.isArray(evidence)) {
    return [];
  }

  const handles: GitHubEvidenceHandle[] = [];

  for (const item of evidence) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const source = item as Record<string, unknown>;
    const handle = {
      id: cleanEvidenceField(source.id),
      provider: cleanEvidenceField(source.provider),
      owner: cleanEvidenceField(source.owner),
      repo: cleanEvidenceField(source.repo),
      ref: cleanEvidenceField(source.ref),
      path: cleanEvidenceField(source.path),
      purpose: cleanEvidenceField(source.purpose),
      authored_by: cleanEvidenceField(source.authored_by),
      citation_label: cleanEvidenceField(source.citation_label),
      max_bytes: cleanEvidenceByteLimit(source.max_bytes)
    };

    if (
      handle.id &&
      handle.provider === "github" &&
      handle.owner &&
      handle.repo &&
      handle.ref &&
      handle.path &&
      handle.purpose &&
      handle.authored_by &&
      handle.citation_label
    ) {
      handles.push(handle);
    }
  }

  return handles;
}

function cleanEvidenceField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanEvidenceByteLimit(value: unknown) {
  const numeric = Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
}

function githubRefNotice(ref: string) {
  if (/^[a-f0-9]{40}$/i.test(ref) || ref.startsWith("refs/tags/")) {
    return "";
  }

  if (ref.startsWith("refs/heads/") || ["main", "master", "develop", "trunk"].includes(ref)) {
    return "Branch ref: requires explicit Operator sign-off for this evidence handle.";
  }

  return "Ref is not a full commit SHA. Confirm it is an immutable tag or explicitly approved.";
}

function FreeTimePanel({
  error,
  expanded,
  loading,
  onAction,
  onToggle,
  requestInProgress,
  selectedAgent,
  status
}: {
  error: string;
  expanded: boolean;
  loading: boolean;
  onAction: (action: "start" | "stop" | "tick") => void;
  onToggle: () => void;
  requestInProgress: boolean;
  selectedAgent: AgentName;
  status: FreeTimeStatus | null;
}) {
  const disabled = loading || requestInProgress;
  const recentEvents = status?.recent_events ?? [];

  return (
    <section className={`health-panel free-time-panel ${expanded ? "" : "collapsed"}`} aria-label="Free Moments">
      <div className="health-heading">
        <h2>
          <button
            aria-expanded={expanded}
            className="health-toggle"
            onClick={onToggle}
            type="button"
          >
            <span>Free Moments</span>
            <span className="health-toggle-icon" aria-hidden="true">
              {expanded ? "-" : "+"}
            </span>
          </button>
        </h2>
        <span className={`status-dot ${status?.running ? "ok" : "warn"}`} title={status?.running ? "running" : "stopped"} />
      </div>

      <div className="health-panel-body" hidden={!expanded}>
        {status ? (
          <>
          <dl className="health-list free-time-list">
            <div>
              <dt>Status</dt>
              <dd>{status.running ? "running" : "stopped"}</dd>
            </div>
            <div>
              <dt>DB switch</dt>
              <dd>{status.durable_enabled === undefined ? "unknown" : status.durable_enabled ? "enabled" : "disabled"}</dd>
            </div>
            <div>
              <dt>Turn</dt>
              <dd>{status.turn_in_progress ? "in progress" : "idle"}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{status.schedule_mode ?? "round_robin"}</dd>
            </div>
            <div>
              <dt>Next agent</dt>
              <dd>{status.next_agents?.join(", ") ?? status.next_agent}</dd>
            </div>
            <div>
              <dt>Last agent</dt>
              <dd>{status.last_agent ?? "none"}</dd>
            </div>
            <div>
              <dt>Cadence</dt>
              <dd>{status.interval_minutes} min</dd>
            </div>
            <div>
              <dt>Next turn</dt>
              <dd>{formatStatusTime(status.next_turn_at)}</dd>
            </div>
            <div>
              <dt>Last turn</dt>
              <dd>{formatStatusTime(status.last_turn_at)}</dd>
            </div>
            <div>
              <dt>Last error</dt>
              <dd>{status.last_error ?? "none"}</dd>
            </div>
          </dl>

          <div className="free-time-actions">
            <button
              className="quiet-action"
              disabled={disabled || status.running}
              onClick={() => onAction("start")}
              type="button"
            >
              {requestInProgress ? "Working" : "Start"}
            </button>
            <button
              className="quiet-action"
              disabled={disabled || !status.running}
              onClick={() => onAction("stop")}
              type="button"
            >
              Stop
            </button>
            <button
              className="quiet-action"
              disabled={disabled || status.turn_in_progress}
              onClick={() => onAction("tick")}
              type="button"
            >
              Wake {selectedAgent} Now
            </button>
          </div>

          <div className="free-time-events">
            <div className="pressure-row">
              <span>Recent events</span>
              <strong>{recentEvents.length}</strong>
            </div>
            {recentEvents.length > 0 ? (
              <ol>
                {recentEvents.map((event) => (
                  <li key={`${event.at}-${event.type}-${event.message}`}>
                    <time dateTime={event.at}>{formatShortTime(event.at)}</time>
                    <span>{event.agent ? `${event.agent}: ` : ""}{event.message}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No Free Moments events yet.</p>
            )}
          </div>
          </>
        ) : (
          <p className="health-empty">{loading ? "Loading Free Moments..." : "Free Moments unavailable."}</p>
        )}

        {error ? <p className="health-error">{error}</p> : null}
      </div>
    </section>
  );
}

function WorkPacketSignalsPanel({
  error,
  expanded,
  loading,
  noteWakeError,
  noteWakeLoading,
  noteWakeRequestInProgress,
  noteWakeStatus,
  onAction,
  onNoteWakeAction,
  onPreview,
  onToggle,
  preview,
  requestInProgress,
  selectedAgent,
  status
}: {
  error: string;
  expanded: boolean;
  loading: boolean;
  noteWakeError: string;
  noteWakeLoading: boolean;
  noteWakeRequestInProgress: boolean;
  noteWakeStatus: OperatorNoteWakeStatus | null;
  onAction: (action: "start" | "stop" | "start_wakes" | "stop_wakes" | "tick") => void;
  onNoteWakeAction: (action: "start" | "stop" | "check") => void;
  onPreview: () => void;
  onToggle: () => void;
  preview: WorkPacketSignalPreview | null;
  requestInProgress: boolean;
  selectedAgent: AgentName;
  status: WorkPacketSignalsStatus | null;
}) {
  const disabled = loading || requestInProgress;
  const recentEvents = status?.recent_events ?? [];
  const noteWakeDisabled = noteWakeLoading || noteWakeRequestInProgress;
  const noteWakeEvents = noteWakeStatus?.recent_events ?? [];

  return (
    <section className={`health-panel signal-panel ${expanded ? "" : "collapsed"}`} aria-label="Work Packet Signals">
      <div className="health-heading">
        <h2>
          <button
            aria-expanded={expanded}
            className="health-toggle"
            onClick={onToggle}
            type="button"
          >
            <span>Packet Signals</span>
            <span className="health-toggle-icon" aria-hidden="true">
              {expanded ? "-" : "+"}
            </span>
          </button>
        </h2>
        <span className={`status-dot ${status?.running ? "ok" : "warn"}`} title={status?.running ? "running" : "stopped"} />
      </div>
      <div className="health-panel-body" hidden={!expanded}>
        <p className="health-empty">Operator awareness, bridge inboxes, and gated packet-signal WAKE.</p>

        {status ? (
          <>
          <dl className="health-list free-time-list">
            <div>
              <dt>Status</dt>
              <dd>{status.running ? "running" : "stopped"}</dd>
            </div>
            <div>
              <dt>DB switch</dt>
              <dd>{status.durable_enabled === undefined ? "unknown" : status.durable_enabled ? "enabled" : "disabled"}</dd>
            </div>
            <div>
              <dt>Signal WAKE</dt>
              <dd>{status.auto_wake_enabled ? "enabled" : "disabled"}</dd>
            </div>
            <div>
              <dt>WAKE DB switch</dt>
              <dd>{status.wake_durable_enabled === undefined ? "unknown" : status.wake_durable_enabled ? "enabled" : "disabled"}</dd>
            </div>
            <div>
              <dt>WAKE active</dt>
              <dd>{status.native_wakes_in_progress?.join(", ") || "none"}</dd>
            </div>
            <div>
              <dt>Check</dt>
              <dd>{status.check_in_progress ? "in progress" : "idle"}</dd>
            </div>
            <div>
              <dt>Cadence</dt>
              <dd>{status.interval_seconds}s</dd>
            </div>
            <div>
              <dt>Next check</dt>
              <dd>{formatStatusTime(status.next_check_at)}</dd>
            </div>
            <div>
              <dt>Last check</dt>
              <dd>{formatStatusTime(status.last_check_at)}</dd>
            </div>
            <div>
              <dt>Last signal</dt>
              <dd>{formatStatusTime(status.last_seen_event_at)}</dd>
            </div>
            <div>
              <dt>Last Soren WAKE</dt>
              <dd>{formatStatusTime(status.last_native_wake_at?.soren ?? null)}</dd>
            </div>
            <div>
              <dt>Last Varro WAKE</dt>
              <dd>{formatStatusTime(status.last_native_wake_at?.varro ?? null)}</dd>
            </div>
            <div>
              <dt>Last error</dt>
              <dd>{status.last_error ?? status.wake_durable_error ?? "none"}</dd>
            </div>
          </dl>

          <div className="free-time-actions">
            <button
              className="quiet-action"
              disabled={disabled || status.running}
              onClick={() => onAction("start")}
              type="button"
            >
              {requestInProgress ? "Working" : "Start"}
            </button>
            <button
              className="quiet-action"
              disabled={disabled || !status.running}
              onClick={() => onAction("stop")}
              type="button"
            >
              Stop
            </button>
            <button
              className="quiet-action"
              disabled={disabled || status.auto_wake_enabled}
              onClick={() => onAction("start_wakes")}
              type="button"
            >
              Start WAKE
            </button>
            <button
              className="quiet-action"
              disabled={disabled || !status.auto_wake_enabled}
              onClick={() => onAction("stop_wakes")}
              type="button"
            >
              Stop WAKE
            </button>
            <button
              className="quiet-action"
              disabled={disabled || status.check_in_progress}
              onClick={() => onAction("tick")}
              type="button"
            >
              Check Now
            </button>
            <button
              className="quiet-action"
              disabled={disabled || status.check_in_progress}
              onClick={onPreview}
              type="button"
            >
              Preview {selectedAgent}
            </button>
          </div>

          <div className="free-time-events">
            <div className="pressure-row">
              <span>Operator Note WAKE</span>
              <strong>{noteWakeStatus?.enabled ? "enabled" : "stopped"}</strong>
            </div>

            {noteWakeStatus ? (
              <dl className="health-list free-time-list">
                <div>
                  <dt>DB switch</dt>
                  <dd>{noteWakeStatus.durable_enabled === undefined ? "unknown" : noteWakeStatus.durable_enabled ? "enabled" : "disabled"}</dd>
                </div>
                <div>
                  <dt>WAKE active</dt>
                  <dd>{noteWakeStatus.native_wakes_in_progress?.join(", ") || "none"}</dd>
                </div>
                <div>
                  <dt>Last check</dt>
                  <dd>{formatStatusTime(noteWakeStatus.last_check_at)}</dd>
                </div>
                <div>
                  <dt>Last Soren note WAKE</dt>
                  <dd>{formatStatusTime(noteWakeStatus.last_native_wake_at?.soren ?? null)}</dd>
                </div>
                <div>
                  <dt>Last Varro note WAKE</dt>
                  <dd>{formatStatusTime(noteWakeStatus.last_native_wake_at?.varro ?? null)}</dd>
                </div>
                <div>
                  <dt>Last error</dt>
                  <dd>{noteWakeStatus.last_error ?? noteWakeStatus.durable_error ?? "none"}</dd>
                </div>
              </dl>
            ) : (
              <p className="health-empty">{noteWakeLoading ? "Loading Operator Note WAKE..." : "Operator Note WAKE unavailable."}</p>
            )}

            <div className="free-time-actions">
              <button
                className="quiet-action"
                disabled={noteWakeDisabled || noteWakeStatus?.enabled}
                onClick={() => onNoteWakeAction("start")}
                type="button"
              >
                {noteWakeRequestInProgress ? "Working" : "Start Note WAKE"}
              </button>
              <button
                className="quiet-action"
                disabled={noteWakeDisabled || !noteWakeStatus?.enabled}
                onClick={() => onNoteWakeAction("stop")}
                type="button"
              >
                Stop Note WAKE
              </button>
              <button
                className="quiet-action"
                disabled={noteWakeDisabled || !noteWakeStatus?.enabled}
                onClick={() => onNoteWakeAction("check")}
                type="button"
              >
                Check Notes
              </button>
            </div>

            {noteWakeError ? <p className="health-error">{noteWakeError}</p> : null}

            {noteWakeEvents.length > 0 ? (
              <ol>
                {noteWakeEvents.slice(-5).map((event) => (
                  <li key={`${event.at}-${event.type}-${event.message}`}>
                    <time dateTime={event.at}>{formatShortTime(event.at)}</time>
                    <span>{event.agent ? `${event.agent}: ` : ""}{event.message}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No Operator Note WAKE events yet.</p>
            )}
          </div>

          {preview ? (
            <div className="free-time-preview">
              <div className="arrival-preview-rows">
                <div className="pressure-row">
                  <span>{preview.agent} packet signals</span>
                  <strong>
                    {preview.visible_count} / {preview.pending_count}
                  </strong>
                </div>
                <div className="pressure-row">
                  <span>Operator Notes</span>
                  <strong>{preview.operator_notes?.unread_count ?? 0} unread</strong>
                </div>
              </div>
              {preview.operator_notes?.error ? (
                <p>{preview.operator_notes.error}</p>
              ) : null}
              {preview.visible_signals.length > 0 ? (
                <ol>
                  {preview.visible_signals.map((event) => (
                    <li key={`${event.id ?? event.at}-${event.type}-${event.message}`}>
                      <time dateTime={event.at}>{formatShortTime(event.at)}</time>
                      <span>
                        {event.packet_title ? `${event.packet_title}: ` : ""}
                        {event.wake_tone ? `[${event.wake_tone}] ` : ""}
                        {event.message}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No visible packet signals for {preview.agent}.</p>
              )}
            </div>
          ) : null}

          <div className="free-time-events">
            <div className="pressure-row">
              <span>Recent signals</span>
              <strong>{recentEvents.length}</strong>
            </div>
            {recentEvents.length > 0 ? (
              <ol>
                {recentEvents.map((event) => (
                  <li key={`${event.at}-${event.type}-${event.message}`}>
                    <time dateTime={event.at}>{formatShortTime(event.at)}</time>
                    <span>
                      {event.packet_title ? `${event.packet_title}: ` : ""}
                      {event.wake_tone ? `[${event.wake_tone}] ` : ""}
                      {event.message}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No packet signals yet.</p>
            )}
          </div>
          </>
        ) : (
          <p className="health-empty">{loading ? "Loading Packet Signals..." : "Packet Signals unavailable."}</p>
        )}

        {error ? <p className="health-error">{error}</p> : null}
      </div>
    </section>
  );
}

function cloneWakeControlPolicy(policy: WakeControlPolicy | null): WakeControlPolicy {
  return JSON.parse(JSON.stringify(policy ?? {})) as WakeControlPolicy;
}

function wakeAgentEnabled(policy: WakeControlPolicy | null, scopeId: WakeControlAgentId) {
  return wakeScopePolicy(policy, scopeId)?.enabled !== false;
}

function wakeScopeControlsEnabled(policy: WakeControlPolicy | null, scopeId: WakeControlAgentId) {
  const globalEnabled = wakeAgentEnabled(policy, "all");

  if (scopeId === "all") {
    return globalEnabled;
  }

  return globalEnabled && wakeAgentEnabled(policy, scopeId);
}

function wakeTriggerEnabled(
  policy: WakeControlPolicy | null,
  scopeId: WakeControlAgentId,
  trigger: WakeControlTrigger
) {
  return wakeScopePolicy(policy, scopeId)?.triggers?.[trigger]?.enabled !== false;
}

function wakeMentionEnabled(
  policy: WakeControlPolicy | null,
  scopeId: WakeControlAgentId,
  trigger: WakeControlTrigger
) {
  return wakeScopePolicy(policy, scopeId)?.triggers?.[trigger]?.mentions?.enabled === true;
}

function setWakeAgentEnabled(
  policy: WakeControlPolicy,
  scopeId: WakeControlAgentId,
  enabled: boolean
) {
  wakeMutableScopePolicy(policy, scopeId).enabled = enabled;

  return policy;
}

function setWakeTriggerEnabled(
  policy: WakeControlPolicy,
  scopeId: WakeControlAgentId,
  trigger: WakeControlTrigger,
  enabled: boolean
) {
  wakeMutableTriggerPolicy(policy, scopeId, trigger).enabled = enabled;

  return policy;
}

function setWakeMentionEnabled(
  policy: WakeControlPolicy,
  scopeId: WakeControlAgentId,
  trigger: WakeControlTrigger,
  enabled: boolean
) {
  const triggerPolicy = wakeMutableTriggerPolicy(policy, scopeId, trigger);
  triggerPolicy.mentions = {
    ...(triggerPolicy.mentions ?? {}),
    enabled,
    names: wakeMentionNamesForScope(scopeId)
  };

  return policy;
}

function wakeScopePolicy(policy: WakeControlPolicy | null, scopeId: WakeControlAgentId) {
  if (scopeId === "all") {
    return policy?.all;
  }

  return policy?.agents?.[scopeId];
}

function wakeMutableScopePolicy(policy: WakeControlPolicy, scopeId: WakeControlAgentId): WakeAgentPolicy {
  if (scopeId === "all") {
    policy.all = policy.all ?? {};
    return policy.all;
  }

  policy.agents = policy.agents ?? {};
  policy.agents[scopeId] = policy.agents[scopeId] ?? {};

  return policy.agents[scopeId];
}

function wakeMutableTriggerPolicy(
  policy: WakeControlPolicy,
  scopeId: WakeControlAgentId,
  trigger: WakeControlTrigger
): WakeTriggerPolicy {
  const scopePolicy = wakeMutableScopePolicy(policy, scopeId);
  scopePolicy.triggers = scopePolicy.triggers ?? {};
  scopePolicy.triggers[trigger] = scopePolicy.triggers[trigger] ?? {};

  return scopePolicy.triggers[trigger];
}

function wakeMentionNamesForScope(scopeId: WakeControlAgentId) {
  if (scopeId === "all") {
    return ["Soren", "Varro", "Julian", "Cael"];
  }

  return [scopeId.replace(/^agent:/, "").replace(/^\w/, (match) => match.toUpperCase())];
}

function liveSessionRequestBody(action: "start" | "end" | "tick" | "dry_run" | "set_policy", draft: LiveSessionDraft) {
  if (action === "start") {
    return {
      action,
      title: "BAR Live Session",
      surface: "bar",
      agents: liveSessionNativeAgents
        .filter((agent) => draft.nativeAgents[agent.id])
        .map((agent) => agent.id),
      bridge_agents: liveSessionBridgeAgents
        .filter((agent) => draft.bridgeAgents[agent.id])
        .map((agent) => agent.id),
      tick_mode: draft.tickMode,
      interval_seconds: draft.intervalSeconds
    };
  }

  if (action === "dry_run") {
    return {
      action: "tick",
      dry_run: true
    };
  }

  if (action === "set_policy") {
    return {
      action: "set_policy",
      tick_mode: draft.tickMode,
      interval_seconds: draft.intervalSeconds
    };
  }

  return { action };
}

function launchpadRequestBody(
  action: "preview" | "create" | "end",
  draft: LaunchpadDraft,
  activeSessionId?: string
) {
  if (action === "end") {
    return {
      action,
      session_id: activeSessionId
    };
  }

  return {
    action,
    title: draft.destination === "eyes" ? "Whole family EYES" : "Whole family BAR",
    surface: draft.destination,
    agents: OPERATOR_NOTE_RECIPIENTS.filter((agent) => draft.agents[agent]),
    intent: "live_session",
    tone: "soft",
    tick_mode: draft.tickMode,
    interval_seconds: draft.intervalSeconds
  };
}

function liveSessionParticipantJoined(session: LiveSession | null, agent: LiveSessionAgent, draft: LiveSessionDraft) {
  const participant = session?.participants[agent];

  if (session) {
    return participant?.status === "joined";
  }

  return agent === "soren" || agent === "varro"
    ? draft.nativeAgents[agent]
    : draft.bridgeAgents[agent];
}

function displayAgentName(agent: OperatorNoteAgent) {
  return {
    soren: "Soren",
    varro: "Varro",
    julian: "Julian",
    cael: "Cael"
  }[agent];
}

function LaunchpadPanel({
  draft,
  error,
  expanded,
  loading,
  onAction,
  onDraftChange,
  onToggle,
  preview,
  requestInProgress,
  status
}: {
  draft: LaunchpadDraft;
  error: string;
  expanded: boolean;
  loading: boolean;
  onAction: (action: "preview" | "create" | "end") => void;
  onDraftChange: (draft: LaunchpadDraft) => void;
  onToggle: () => void;
  preview: LaunchpadInvitation | null;
  requestInProgress: boolean;
  status: LaunchpadStatus | null;
}) {
  const selectedAgents = OPERATOR_NOTE_RECIPIENTS
    .filter((agent) => draft.agents[agent])
    .map((agent) => displayAgentName(agent));
  const latestInvitation = preview ?? status?.invitations[0] ?? null;
  const disabled = loading || requestInProgress;
  const canLaunch = selectedAgents.length > 0;
  const active = Boolean(status?.active_live_session_id);

  return (
    <section className={`health-panel launchpad-panel ${expanded ? "" : "collapsed"}`} aria-label="Launchpad controls">
      <div className="health-heading">
        <h2>
          <button
            aria-expanded={expanded}
            className="health-toggle"
            onClick={onToggle}
            type="button"
          >
            <span>LAUNCHPAD</span>
            <span className="health-toggle-icon" aria-hidden="true">
              {expanded ? "-" : "+"}
            </span>
          </button>
        </h2>
        <span className={`status-pill ${active ? "ok" : "warn"}`}>
          {requestInProgress ? "working" : active ? "active" : "ready"}
        </span>
      </div>

      <div className="health-panel-body" hidden={!expanded}>
        <p className="health-empty">Invite selected agents into a shared surface through their configured lanes.</p>

        <div className="launchpad-summary">
          <label>
            <span>Destination</span>
            <select
              disabled={disabled}
              onChange={(event) => onDraftChange({
                ...draft,
                destination: event.target.value as LaunchpadDestination
              })}
              value={draft.destination}
            >
              {launchpadDestinations.map((destination) => (
                <option
                  disabled={destination.status !== "live"}
                  key={destination.id}
                  value={destination.id}
                >
                  {destination.label}{destination.status === "planned" ? " - planned" : ""}
                </option>
              ))}
            </select>
          </label>
          <span>Agents</span>
          <strong title={selectedAgents.join(", ") || "none"}>{selectedAgents.join(", ") || "none"}</strong>
          <span>Mode</span>
          <strong>{draft.tickMode === "interval" ? `${draft.intervalSeconds}s interval` : "manual"}</strong>
        </div>

        <div className="launchpad-agent-list">
          {OPERATOR_NOTE_RECIPIENTS.map((agent) => (
            <div className="wake-switch-row" key={agent}>
              <span title={displayAgentName(agent)}>{displayAgentName(agent)}</span>
              <WakeSwitch
                checked={draft.agents[agent]}
                disabled={disabled}
                label={`${displayAgentName(agent)} Launchpad invite`}
                offText="Out"
                onChange={(checked) => onDraftChange({
                  ...draft,
                  agents: {
                    ...draft.agents,
                    [agent]: checked
                  }
                })}
                onText="In"
              />
            </div>
          ))}
        </div>

        <div className="live-session-policy">
          <label>
            <span>Mode</span>
            <select
              disabled={disabled}
              onChange={(event) => onDraftChange({
                ...draft,
                tickMode: event.target.value === "interval" ? "interval" : "manual"
              })}
              value={draft.tickMode}
            >
              <option value="manual">Manual</option>
              <option value="interval">Interval</option>
            </select>
          </label>
          <label>
            <span>Seconds</span>
            <input
              disabled={disabled || draft.tickMode !== "interval"}
              min={10}
              max={300}
              onChange={(event) => onDraftChange({
                ...draft,
                intervalSeconds: Math.min(300, Math.max(10, Number(event.target.value) || 30))
              })}
              type="number"
              value={draft.intervalSeconds}
            />
          </label>
        </div>

        <div className="health-actions launchpad-actions">
          <button
            disabled={disabled || !canLaunch}
            onClick={() => onAction("preview")}
            type="button"
          >
            Preview
          </button>
          <button
            disabled={disabled || !canLaunch || active}
            onClick={() => onAction("create")}
            type="button"
          >
            Create
          </button>
          <button
            disabled={disabled || !active}
            onClick={() => onAction("end")}
            type="button"
          >
            End
          </button>
        </div>

        {latestInvitation ? (
          <div className="launchpad-preview" aria-label="Latest Launchpad invitation">
            <div className="launchpad-preview-heading">
              <strong>{latestInvitation.title}</strong>
              <span>{latestInvitation.status}</span>
            </div>
            <ol>
              {latestInvitation.invitees.map((invitee) => (
                <li key={invitee.participant_id}>
                  <span>
                    <strong>{invitee.display_name}</strong>
                    <small>{invitee.lane.label}</small>
                  </span>
                  <span className={`status-pill ${invitee.status === "present" ? "ok" : invitee.status === "failed" ? "bad" : "warn"}`}>
                    {invitee.status}
                  </span>
                </li>
              ))}
            </ol>
            {latestInvitation.session_id ? (
              <p title={latestInvitation.session_id}>Session {latestInvitation.session_id.slice(0, 8)}</p>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="health-error">{error}</p> : null}
      </div>
    </section>
  );
}

function LiveSessionPanel({
  draft,
  error,
  expanded,
  loading,
  onAction,
  onDraftChange,
  onToggle,
  onToggleAgent,
  requestInProgress,
  status
}: {
  draft: LiveSessionDraft;
  error: string;
  expanded: boolean;
  loading: boolean;
  onAction: (action: "start" | "end" | "tick" | "dry_run" | "set_policy") => void;
  onDraftChange: (draft: LiveSessionDraft) => void;
  onToggle: () => void;
  onToggleAgent: (agent: LiveSessionAgent, enabled: boolean) => void;
  requestInProgress: boolean;
  status: LiveSessionStatus | null;
}) {
  const activeSession = status?.active_session ?? null;
  const runner = status?.runner ?? null;
  const bridgeAttendants = Object.values(activeSession?.bridge_attendants ?? {})
    .filter((attendant) => attendant?.status === "attending").length;
  const pendingBridgeDeliveries = activeSession?.bridge_deliveries
    .filter((delivery) => delivery.status === "pending" || delivery.status === "claimed").length ?? 0;
  const disabled = loading || requestInProgress;

  return (
    <section className={`health-panel live-session-panel ${expanded ? "" : "collapsed"}`} aria-label="Live Session Host controls">
      <div className="health-heading">
        <h2>
          <button
            aria-expanded={expanded}
            className="health-toggle"
            onClick={onToggle}
            type="button"
          >
            <span>LIVE SESSION</span>
            <span className="health-toggle-icon" aria-hidden="true">
              {expanded ? "-" : "+"}
            </span>
          </button>
        </h2>
        <span className={`status-pill ${activeSession ? "ok" : "warn"}`}>
          {requestInProgress ? "working" : activeSession ? "active" : "idle"}
        </span>
      </div>

      <div className="health-panel-body" hidden={!expanded}>
        {activeSession ? (
          <div className="live-session-summary">
            <strong>{activeSession.title}</strong>
            <span>{Object.values(activeSession.participants).filter((participant) => participant?.status === "joined").length} in</span>
            <span>
              {runner?.status === "running"
                ? `runner ${runner.interval_seconds}s`
                : activeSession.tick_policy.mode === "interval"
                  ? "runner stopped"
                  : "manual tick"}
            </span>
            {bridgeAttendants ? <span>{bridgeAttendants} bridge attending</span> : null}
            {pendingBridgeDeliveries ? <span>{pendingBridgeDeliveries} bridge queued</span> : null}
          </div>
        ) : (
          <p className="health-empty">Start a BAR room session. Native agents tick; bridge agents receive delivery jobs.</p>
        )}

        <div className="live-session-groups">
          <div>
            <h3>Native</h3>
            {liveSessionNativeAgents.map((agent) => (
              <div className="wake-switch-row" key={agent.id}>
                <span title={agent.label}>{agent.label}</span>
                <WakeSwitch
                  checked={liveSessionParticipantJoined(activeSession, agent.id, draft)}
                  disabled={disabled}
                  label={`${agent.label} live session`}
                  offText="Out"
                  onChange={(checked) => onToggleAgent(agent.id, checked)}
                  onText="In"
                />
              </div>
            ))}
          </div>
          <div>
            <h3>Bridge</h3>
            {liveSessionBridgeAgents.map((agent) => (
              <div className="live-session-bridge-agent" key={agent.id}>
                <div className="wake-switch-row">
                  <span title={agent.label}>{agent.label}</span>
                  <WakeSwitch
                    checked={liveSessionParticipantJoined(activeSession, agent.id, draft)}
                    disabled={disabled}
                    label={`${agent.label} live session bridge`}
                    offText="Out"
                    onChange={(checked) => onToggleAgent(agent.id, checked)}
                    onText="In"
                  />
                </div>
                {activeSession ? (
                  <LiveSessionBridgeStatus
                    adapterStatus={status?.bridge_adapters?.[agent.id]}
                    agent={agent.id}
                    session={activeSession}
                  />
                ) : status?.bridge_adapters?.[agent.id] ? (
                  <LiveSessionBridgeStatus
                    adapterStatus={status.bridge_adapters[agent.id]}
                    agent={agent.id}
                    session={null}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="live-session-policy">
          <label>
            <span>Mode</span>
            <select
              disabled={disabled}
              onChange={(event) => onDraftChange({
                ...draft,
                tickMode: event.target.value === "interval" ? "interval" : "manual"
              })}
              value={draft.tickMode}
            >
              <option value="manual">Manual</option>
              <option value="interval">Interval</option>
            </select>
          </label>
          <label>
            <span>Seconds</span>
            <input
              disabled={disabled || draft.tickMode !== "interval"}
              min={10}
              max={300}
              onChange={(event) => onDraftChange({
                ...draft,
                intervalSeconds: Math.min(300, Math.max(10, Number(event.target.value) || 30))
              })}
              type="number"
              value={draft.intervalSeconds}
            />
          </label>
        </div>

        <div className="health-actions live-session-actions">
          <button
            disabled={disabled || Boolean(activeSession)}
            onClick={() => onAction("start")}
            type="button"
          >
            Start
          </button>
          <button
            disabled={disabled || !activeSession}
            onClick={() => onAction("dry_run")}
            type="button"
          >
            Dry Run
          </button>
          <button
            disabled={disabled || !activeSession}
            onClick={() => onAction("tick")}
            type="button"
          >
            Tick
          </button>
          <button
            disabled={disabled || !activeSession}
            onClick={() => onAction("set_policy")}
            type="button"
          >
            Apply
          </button>
          <button
            disabled={disabled || !activeSession}
            onClick={() => onAction("end")}
            type="button"
          >
            End
          </button>
        </div>

        {activeSession?.events.length ? (
          <ol className="free-time-events live-session-events">
            {activeSession.events.slice(0, 4).map((event) => (
              <li key={event.id}>
                <time dateTime={event.at}>{formatMessageTime(event.at)}</time>
                <span>{event.message}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {error ? <p className="health-error">{error}</p> : null}
      </div>
    </section>
  );
}

function LiveSessionBridgeStatus({
  adapterStatus,
  agent,
  session
}: {
  adapterStatus?: LiveSessionBridgeAdapterStatus;
  agent: LiveSessionBridgeAgent;
  session: LiveSession | null;
}) {
  const attendant = session?.bridge_attendants[agent];
  const deliveries = session?.bridge_deliveries.filter((delivery) => delivery.agent === agent) ?? [];
  const activeDeliveries = deliveries.filter((delivery) => delivery.status === "pending" || delivery.status === "claimed");
  const latestDelivery = deliveries[0];
  const target = latestDelivery?.target ?? adapterStatus?.target;
  const statusLabel = activeDeliveries.length
    ? `${activeDeliveries.length} queued`
    : adapterStatus?.ready
      ? "auto ready"
      : target?.method === "manual" && target?.status === "configured"
        ? "pull ready"
      : target?.status === "configured"
        ? "manual ready"
      : target?.status === "adapter_required"
        ? "adapter needed"
        : attendant?.status === "attending"
          ? "watching"
          : "not watching";
  const lastAt = latestDelivery?.updated_at ?? attendant?.last_delivery_completed_at ?? attendant?.last_poll_at ?? null;
  const error = attendant?.last_error ?? latestDelivery?.last_error ?? adapterStatus?.reason;

  return (
    <div className="live-session-bridge-status">
      <span>{statusLabel}</span>
      {lastAt ? <time dateTime={lastAt}>{formatMessageTime(lastAt)}</time> : null}
      {error ? (
        <span title={error}>detail</span>
      ) : null}
    </div>
  );
}

function WakeControlPanel({
  error,
  expanded,
  loading,
  onRefresh,
  onToggle,
  onToggleAgent,
  onToggleMention,
  onToggleTrigger,
  policy,
  saving
}: {
  error: string;
  expanded: boolean;
  loading: boolean;
  onRefresh: () => void;
  onToggle: () => void;
  onToggleAgent: (scopeId: WakeControlAgentId, enabled: boolean) => void;
  onToggleMention: (scopeId: WakeControlAgentId, trigger: WakeControlTrigger, enabled: boolean) => void;
  onToggleTrigger: (scopeId: WakeControlAgentId, trigger: WakeControlTrigger, enabled: boolean) => void;
  policy: WakeControlPolicy | null;
  saving: boolean;
}) {
  const disabled = loading || saving;

  return (
    <section className={`health-panel wake-panel ${expanded ? "" : "collapsed"}`} aria-label="WAKE controls">
      <div className="health-heading">
        <h2>
          <button
            aria-expanded={expanded}
            className="health-toggle"
            onClick={onToggle}
            type="button"
          >
            <span>WAKE</span>
            <span className="health-toggle-icon" aria-hidden="true">
              {expanded ? "-" : "+"}
            </span>
          </button>
        </h2>
        <span className={`status-pill ${policy ? "ok" : "warn"}`}>
          {saving ? "saving" : loading ? "loading" : policy ? "custom" : "default"}
        </span>
      </div>

      <div className="health-panel-body" hidden={!expanded}>
        <p className="health-empty">Applies on the next WAKE evaluation; use Check Now or Check Notes to pull sooner.</p>

        <div className="wake-control-actions">
          <button
            className="quiet-action"
            disabled={disabled}
            onClick={onRefresh}
            type="button"
          >
            Refresh Policy
          </button>
        </div>

        <div className="wake-agent-list">
          {wakeControlAgents.map((agent) => {
            const scopeEnabled = wakeScopeControlsEnabled(policy, agent.id);
            const childDisabled = disabled || !scopeEnabled;

            return (
              <div className={`wake-agent-card ${scopeEnabled ? "" : "gated"}`} key={agent.id}>
                <div className="wake-agent-heading">
                  <strong title={agent.label}>{agent.label}</strong>
                  <WakeSwitch
                    checked={wakeAgentEnabled(policy, agent.id)}
                    disabled={disabled}
                    label={`${agent.label} master WAKE`}
                    onChange={(checked) => onToggleAgent(agent.id, checked)}
                  />
                </div>

                <div className="wake-switch-list">
                  {wakeControlTriggers.map((trigger) => (
                    <div className="wake-trigger-group" key={trigger.id}>
                      <div className="wake-switch-row">
                        <span title={trigger.label}>{trigger.label}</span>
                        <WakeSwitch
                          checked={wakeTriggerEnabled(policy, agent.id, trigger.id)}
                          disabled={childDisabled}
                          label={`${agent.label} ${trigger.label}`}
                          onChange={(checked) => onToggleTrigger(agent.id, trigger.id, checked)}
                        />
                      </div>
                      <div className="wake-switch-row">
                        <span title={`${trigger.label} Mentions`}>{trigger.label} Mentions</span>
                        <WakeSwitch
                          checked={wakeMentionEnabled(policy, agent.id, trigger.id)}
                          disabled={childDisabled}
                          label={`${agent.label} ${trigger.label} mentions`}
                          onChange={(checked) => onToggleMention(agent.id, trigger.id, checked)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {error ? <p className="health-error">{error}</p> : null}
      </div>
    </section>
  );
}

function WakeSwitch({
  checked,
  disabled,
  label,
  offText = "Off",
  onChange,
  onText = "On"
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  offText?: string;
  onChange: (checked: boolean) => void;
  onText?: string;
}) {
  return (
    <label className="wake-switch" title={label}>
      <span className="visually-hidden">{label}</span>
      <input
        aria-label={label}
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        role="switch"
        type="checkbox"
      />
      <span aria-hidden="true" className="wake-switch-track">
        <span className="wake-switch-thumb" />
      </span>
      <span aria-hidden="true" className="wake-switch-text">{checked ? onText : offText}</span>
    </label>
  );
}

function RuntimeHealthPanel({
  activeHealth,
  compactionError,
  compactionLoading,
  compactionPreview,
  compileError,
  compileLoading,
  expanded,
  health,
  onCompileProposal,
  onLoadApprovedProposal,
  onPreviewCompaction,
  onToggle,
  savedProposalError,
  savedProposalLoading
}: {
  activeHealth: AgentHealth | undefined;
  compactionError: string;
  compactionLoading: boolean;
  compactionPreview: CompactionPreview | null;
  compileError: string;
  compileLoading: boolean;
  expanded: boolean;
  health: Health | null;
  onCompileProposal: () => void;
  onLoadApprovedProposal: () => void;
  onPreviewCompaction: () => void;
  onToggle: () => void;
  savedProposalError: string;
  savedProposalLoading: boolean;
}) {
  const envOk = health ? Object.values(health.env).every(Boolean) : false;
  const pressure = activeHealth?.compaction_pressure;

  return (
    <section className={`health-panel ${expanded ? "" : "collapsed"}`} aria-label="Runtime health">
      <div className="health-heading">
        <h2>
          <button
            aria-expanded={expanded}
            className="health-toggle"
            onClick={onToggle}
            type="button"
          >
            <span>Runtime</span>
            <span className="health-toggle-icon" aria-hidden="true">
              {expanded ? "-" : "+"}
            </span>
          </button>
        </h2>
        <span className={`status-dot ${activeHealth?.status === "ok" ? "ok" : "warn"}`} title={activeHealth?.status ?? "unknown"} />
      </div>

      <div className="health-panel-body" hidden={!expanded}>
        {activeHealth ? (
          <>
          <dl className="health-list">
            <div>
              <dt>Model</dt>
              <dd>{activeHealth.model}</dd>
            </div>
            <div>
              <dt>Active messages</dt>
              <dd>
                {activeHealth.conversation.message_count}
                {activeHealth.conversation.total_message_count &&
                activeHealth.conversation.total_message_count !== activeHealth.conversation.message_count
                  ? ` / ${activeHealth.conversation.total_message_count} total`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>
                {activeHealth.memory.active_rows} active / {activeHealth.memory.core_rows} core
              </dd>
            </div>
            <div>
              <dt>Journal</dt>
              <dd>
                {activeHealth.memory.journal_entries_error
                  ? "schema needed"
                  : activeHealth.memory.journal_entries ?? 0}
              </dd>
            </div>
            <div>
              <dt>Tool log</dt>
              <dd>
                {activeHealth.memory.tool_events_error
                  ? "schema needed"
                  : activeHealth.memory.tool_events ?? 0}
              </dd>
            </div>
            <div>
              <dt>Model usage</dt>
              <dd>
                {activeHealth.usage?.error
                  ? "schema needed"
                  : `${activeHealth.usage?.calls ?? 0} calls / ${(
                      activeHealth.usage?.total_tokens ?? 0
                    ).toLocaleString()} tokens`}
              </dd>
            </div>
            <div>
              <dt>Tools</dt>
              <dd>{health?.tools.count ?? 0}</dd>
            </div>
            <div>
              <dt>Output cap</dt>
              <dd>{health?.runtime.max_tokens ?? "?"}</dd>
            </div>
            <div>
              <dt>Rounds</dt>
              <dd>{health?.runtime.max_tool_rounds ?? "?"}</dd>
            </div>
            <div>
              <dt>Cache</dt>
              <dd>
                {health?.runtime.prompt_cache
                  ? `on (${health.runtime.prompt_cache_ttl})`
                  : "off"}
              </dd>
            </div>
            <div>
              <dt>Env</dt>
              <dd>{envOk ? "ready" : "check"}</dd>
            </div>
          </dl>

          <div className="pressure">
            <div className="pressure-row">
              <span>Room pressure</span>
              <strong>{pressure?.level ?? "unknown"}</strong>
            </div>
            <div className="pressure-track">
              <span
                className={`pressure-fill ${pressure?.level ?? "low"}`}
                style={{ width: `${Math.min(100, Math.max(0, pressure?.percent ?? 0))}%` }}
              />
            </div>
            <p>{health?.compaction.status ?? "unknown"} · {health?.compaction.mode ?? "manual"}</p>
            {activeHealth.conversation.latest_checkpoint_at ? (
              <p>room refresh active; raw transcript retained</p>
            ) : null}
          </div>

          <button
            className="quiet-action"
            disabled={compactionLoading}
            onClick={onPreviewCompaction}
            type="button"
          >
            {compactionLoading ? "Reviewing" : "Review Room"}
          </button>

          <button
            className="quiet-action"
            disabled={savedProposalLoading}
            onClick={onLoadApprovedProposal}
            type="button"
          >
            {savedProposalLoading ? "Loading" : "Load Approved Note"}
          </button>

          {compactionError ? <p className="health-error">{compactionError}</p> : null}
          {savedProposalError ? <p className="health-error">{savedProposalError}</p> : null}

          {compactionPreview ? (
            <div className="compaction-preview">
              <p>
                <strong>Room review ready</strong>
              </p>
              <p>No messages changed. This is a read-only look at what the room may need to carry forward.</p>
              <dl>
                <div>
                  <dt>Messages</dt>
                  <dd>{compactionPreview.conversation.message_count}</dd>
                </div>
                <div>
                  <dt>Chars</dt>
                  <dd>{compactionPreview.conversation.saved_characters.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Pressure</dt>
                  <dd>{compactionPreview.pressure.level}</dd>
                </div>
              </dl>
              <p>Next: ask the Agent to author what mattered before any housekeeping is sent.</p>
              <button
                className="quiet-action"
                disabled={compileLoading}
                onClick={onCompileProposal}
                type="button"
              >
                {compileLoading ? "Drafting" : "Draft Room Note"}
              </button>
              {compileError ? <p className="health-error">{compileError}</p> : null}
            </div>
          ) : null}

          <p className="health-time">Updated {health?.local_time ?? "unknown"}</p>
          </>
        ) : (
          <p className="health-empty">Health unavailable.</p>
        )}
      </div>
    </section>
  );
}

function trimLiveMessages(messages: ChatMessage[]) {
  return messages.slice(-liveTranscriptLimit);
}

function conversationLabel(agent: AgentName) {
  return `${agent}-main`;
}

function participantAdapterLabel(participant: CafeParticipant) {
  const displayLabel = cafeParticipantAdapterDisplayLabel(participant.metadata);

  if (displayLabel) {
    return displayLabel;
  }

  switch (participant.participant_adapter) {
    case "operator_browser":
      return "Operator";
    case "runtime_native":
      return "Runtime";
    case "codex_local":
      return "Codex";
    case "external_bridge":
      return "Bridge";
    default:
      return participant.participant_adapter;
  }
}

function presenceStateLabel(state: PresenceState) {
  switch (state) {
    case "present":
      return "Present";
    case "absent":
      return "Absent";
    case "stale":
      return "Stale";
    case "degraded":
      return "Degraded";
    case "unknown":
      return "Unknown";
    default:
      return state;
  }
}

function cafeParticipantAdapterDisplayLabel(metadata: CafeParticipant["metadata"]) {
  const label = metadata.adapter_display_name;

  return typeof label === "string" && label.trim() ? label.trim() : null;
}

function participantDisplayName(participantId: string) {
  switch (participantId) {
    case "operator:chris":
      return "Chris";
    case "agent:soren":
      return "Soren";
    case "agent:varro":
      return "Varro";
    case "agent:julian":
      return "Julian";
    case "agent:cael":
      return "Cael";
    default:
      return participantId;
  }
}

function actorDisplayName(actorId: string) {
  return participantDisplayName(actorId);
}

function operatorNoteEventLabel(eventType: OperatorNoteEvent["event_type"]) {
  switch (eventType) {
    case "created":
      return "Created";
    case "reply":
      return "Reply";
    default:
      return eventType;
  }
}

function operatorNoteAttentionLabel(note: OperatorNote) {
  if (note.operator_status === "unread") {
    return "Needs Chris";
  }

  if (note.agent_status === "unread") {
    return `Waiting on ${participantDisplayName(`agent:${note.agent}`)}`;
  }

  return "Settled";
}

function operatorNoteMatchesFilter(note: OperatorNote, filter: OperatorNoteFilter) {
  switch (filter) {
    case "active":
      return note.operator_status === "unread" || note.agent_status === "unread";
    case "needs_operator":
      return note.operator_status === "unread";
    case "waiting_agent":
      return note.operator_status === "read" && note.agent_status === "unread";
    case "settled":
      return note.operator_status === "read" && note.agent_status === "read";
    case "all":
      return true;
    default:
      return true;
  }
}

function isPendingOperatorRollup(packet: WorkPacket) {
  const rollup = packet.review_rollup ?? {};

  return (
    packet.status === "review" &&
    Boolean(rollup.summary?.trim()) &&
    rollup.operator_review?.state !== "approved" &&
    rollup.operator_review?.state !== "changes_requested" &&
    rollup.operator_review?.state !== "hold"
  );
}

function attachmentsFromCafeMetadata(metadata: Record<string, unknown>): SourceMaterialReference[] {
  const attachments = metadata.attachments;

  if (!Array.isArray(attachments)) {
    return [];
  }

  const parsed: SourceMaterialReference[] = [];

  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") {
      continue;
    }

    const source = attachment as Record<string, unknown>;
    const id = String(source.id ?? "").trim();
    const title = String(source.title ?? "").trim();
    const materialType = String(source.material_type ?? "file").trim();

    if (!id || !title) {
      continue;
    }

    parsed.push({
      id,
      title,
      bucket: typeof source.bucket === "string" ? source.bucket : undefined,
      storage_path: typeof source.storage_path === "string" ? source.storage_path : undefined,
      material_type: materialType || "file",
      mime_type: typeof source.mime_type === "string" ? source.mime_type : null,
      size_bytes: typeof source.size_bytes === "number" ? source.size_bytes : null,
      readable_as_text: source.readable_as_text === true,
      metadata:
        source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
          ? (source.metadata as Record<string, unknown>)
          : null
    });
  }

  return parsed;
}

function framesFromEyesMetadata(metadata: Record<string, unknown>): SourceMaterialReference[] {
  const frames = metadata.frames;

  if (!Array.isArray(frames)) {
    return [];
  }

  const parsed: SourceMaterialReference[] = [];

  for (const frame of frames) {
    if (!frame || typeof frame !== "object") {
      continue;
    }

    const source = frame as Record<string, unknown>;
    const id = String(source.id ?? "").trim();
    const title = String(source.title ?? "").trim();
    const materialType = String(source.material_type ?? "image").trim();

    if (!id || !title) {
      continue;
    }

    parsed.push({
      id,
      title,
      bucket: typeof source.bucket === "string" ? source.bucket : undefined,
      storage_path: typeof source.storage_path === "string" ? source.storage_path : undefined,
      material_type: materialType || "image",
      mime_type: typeof source.mime_type === "string" ? source.mime_type : null,
      size_bytes: typeof source.size_bytes === "number" ? source.size_bytes : null,
      readable_as_text: source.readable_as_text === true,
      metadata:
        source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
          ? (source.metadata as Record<string, unknown>)
          : null
    });
  }

  return parsed;
}

function savedProposalLabel(proposal: CompactionCompile) {
  if (!proposal.saved_proposal_id) {
    return "";
  }

  const shortId = proposal.saved_proposal_id.slice(0, 8);
  const updatedAt = formatMessageTime(proposal.generated_at);

  return [
    `Loaded ${proposal.saved_proposal_status ?? "saved"} note ${shortId}`,
    updatedAt ? `updated ${updatedAt}` : null
  ]
    .filter(Boolean)
    .join(" · ");
}

function sourceSummaryFromSavedProposal(value: unknown): CompactionCompile["source"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;

  return {
    bounded: source.bounded === true,
    omitted_message_count: safeNumber(source.omitted_message_count),
    selected_characters: safeNumber(source.selected_characters),
    selected_message_count: safeNumber(source.selected_message_count),
    transcript_budget_chars: safeNumber(source.transcript_budget_chars)
  };
}

function createLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatStatusTime(value: string | null) {
  if (!value) {
    return "none";
  }

  return formatMessageTime(value) || value;
}

function formatShortTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatMessageTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
