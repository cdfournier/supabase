"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type SourceMaterialReference,
  attachmentsFromContent,
  formatBytes,
  textFromContent
} from "@/lib/source-materials-shared";

type AgentName = "soren" | "varro";
type ActiveSurface = "chat" | "cafe" | "inbox";

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
  check_in_progress: boolean;
  interval_seconds: number;
  last_check_at: string | null;
  next_check_at: string | null;
  last_seen_event_at: string | null;
  last_error: string | null;
  recent_events: WorkPacketSignalEvent[];
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

type ControlPanelKey = "runtime" | "freeMoments" | "packetSignals";
type ControlPanelState = Record<ControlPanelKey, boolean>;

const defaultAgent: AgentName = "soren";
const freeTimePollMs = 30_000;
const workPacketSignalsPollMs = 15_000;
const liveTranscriptLimit = 120;
const expandedControlPanels: ControlPanelState = {
  runtime: true,
  freeMoments: true,
  packetSignals: true
};
const collapsedControlPanels: ControlPanelState = {
  runtime: false,
  freeMoments: false,
  packetSignals: false
};

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
  const [operatorInboxPackets, setOperatorInboxPackets] = useState<WorkPacket[]>([]);
  const [operatorInboxLoading, setOperatorInboxLoading] = useState(true);
  const [operatorInboxError, setOperatorInboxError] = useState("");
  const [operatorInboxNotes, setOperatorInboxNotes] = useState<Record<string, string>>({});
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

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.name === selectedAgent),
    [agents, selectedAgent]
  );
  const activeMessages = transcripts[selectedAgent] ?? [];
  const activeToolEvents = toolEvents[selectedAgent] ?? [];
  const pendingOperatorRollups = operatorInboxPackets.filter(isPendingOperatorRollup);
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
      const data = await response.json();

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
      const data = await response.json();

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

  const loadOperatorInbox = useCallback(async () => {
    setOperatorInboxError("");

    try {
      const response = await fetch("/api/work-packets?status=review&limit=12");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load Operator Inbox.");
      }

      setOperatorInboxPackets(data.packets ?? []);
    } catch (inboxError) {
      setOperatorInboxError(
        inboxError instanceof Error ? inboxError.message : "Could not load Operator Inbox."
      );
    } finally {
      setOperatorInboxLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAgents() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/agents");
        const data = await response.json();

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
      const data = await response.json();

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

  useEffect(() => {
    void loadCafe();
  }, [loadCafe]);

  useEffect(() => {
    void loadOperatorInbox();
  }, [loadOperatorInbox]);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetch("/api/health");
        const data = await response.json();

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
      const data = await response.json();

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
      const data = await response.json();

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
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load the approved note.");
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
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not send housekeeping.");
      }

      setCheckpointReceipt(data);

      const healthResponse = await fetch("/api/health");
      const healthData = await healthResponse.json();

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
      const data = await response.json();

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

  async function runWorkPacketSignalsAction(action: "start" | "stop" | "tick") {
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
      const data = await response.json();

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
      const data = await response.json();

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
      const data = await response.json();

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
      const data = await response.json();

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
      const data = await response.json();

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
    const data = await response.json();

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
    const data = await response.json();

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
          className={`cafe-button ${activeSurface === "inbox" ? "active" : ""}`}
          onClick={() => {
            setActiveSurface("inbox");
            void loadOperatorInbox();
          }}
          type="button"
        >
          <strong>Inbox</strong>
          <br />
          <span>{pendingOperatorRollups.length} rollup{pendingOperatorRollups.length === 1 ? "" : "s"}</span>
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

        <WorkPacketSignalsPanel
          error={workPacketSignalsError}
          expanded={controlPanels.packetSignals}
          loading={workPacketSignalsLoading}
          onAction={runWorkPacketSignalsAction}
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
      ) : activeSurface === "inbox" ? (
        <OperatorInboxView
          actionInProgress={operatorInboxActionInProgress}
          error={operatorInboxError}
          loading={operatorInboxLoading}
          notes={operatorInboxNotes}
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

function OperatorInboxView({
  actionInProgress,
  error,
  loading,
  notes,
  onNoteChange,
  onRefresh,
  onReview,
  packets
}: {
  actionInProgress: string | null;
  error: string;
  loading: boolean;
  notes: Record<string, string>;
  onNoteChange: (packetId: string, note: string) => void;
  onRefresh: () => void;
  onReview: (packetId: string, reviewState: "approved" | "request_changes" | "hold") => void;
  packets: WorkPacket[];
}) {
  return (
    <section className="main inbox-main">
      <header className="header inbox-header">
        <div>
          <h2>Operator Inbox</h2>
          <p>Rollups awaiting review. The packet remains the source trail.</p>
        </div>
        <button className="quiet-action" disabled={loading || Boolean(actionInProgress)} onClick={onRefresh} type="button">
          Refresh
        </button>
      </header>

      <div className="inbox-list">
        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="empty">Loading Operator Inbox...</p> : null}
        {!loading && !packets.length ? (
          <p className="empty">No rollups are waiting for Operator review.</p>
        ) : null}

        {packets.map((packet) => {
          const rollup = packet.review_rollup ?? {};
          const evidenceHandles = githubEvidenceHandlesFromMetadata(packet.metadata);
          const note = notes[packet.id] ?? "";
          const actionDisabled = Boolean(actionInProgress);

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
      </div>
    </section>
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
  onAction,
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
  onAction: (action: "start" | "stop" | "tick") => void;
  onPreview: () => void;
  onToggle: () => void;
  preview: WorkPacketSignalPreview | null;
  requestInProgress: boolean;
  selectedAgent: AgentName;
  status: WorkPacketSignalsStatus | null;
}) {
  const disabled = loading || requestInProgress;
  const recentEvents = status?.recent_events ?? [];

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
        <p className="health-empty">Operator awareness and bridge inboxes. No auto-wakes yet.</p>

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

          {preview ? (
            <div className="free-time-preview">
              <div className="pressure-row">
                <span>{preview.agent} signal inbox</span>
                <strong>
                  {preview.visible_count} / {preview.pending_count}
                </strong>
              </div>
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
