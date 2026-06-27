"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type AgentName = "soren" | "varro";

type Agent = {
  name: AgentName;
  display_name: string | null;
  status: string | null;
};

type ChatMessage = {
  id?: string;
  conversation_id: string;
  position: number;
  role: "user" | "assistant";
  content: unknown;
  created_at?: string;
};

type Health = {
  generated_at: string;
  local_time: string;
  runtime: {
    max_tokens: number;
    history_messages: number;
    history_message_chars: number;
    max_tool_rounds: number;
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
  agents: AgentHealth[];
};

type AgentHealth = {
  agent: AgentName;
  model: string;
  status: string;
  conversation: {
    message_count: number;
    saved_characters: number;
    stored_token_count: number;
    compaction_count: number;
    last_message_at: string | null;
  };
  memory: {
    rows: number;
    active_rows: number;
    core_rows: number;
    relationships: number;
    compaction_policy_configured: boolean;
  };
  compaction_pressure: {
    level: "low" | "medium" | "high";
    percent: number;
    note: string;
  };
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

const defaultAgent: AgentName = "soren";

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentName>(defaultAgent);
  const [transcripts, setTranscripts] = useState<Record<string, ChatMessage[]>>({});
  const [health, setHealth] = useState<Health | null>(null);
  const [compactionPreview, setCompactionPreview] = useState<CompactionPreview | null>(null);
  const [compactionLoading, setCompactionLoading] = useState(false);
  const [compactionError, setCompactionError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.name === selectedAgent),
    [agents, selectedAgent]
  );
  const activeMessages = transcripts[selectedAgent] ?? [];
  const activeHealth = health?.agents.find((agent) => agent.agent === selectedAgent);

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
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [activeMessages.length, selectedAgent]);

  useEffect(() => {
    setCompactionPreview(null);
    setCompactionError("");
  }, [selectedAgent]);

  async function previewCompaction() {
    setCompactionLoading(true);
    setCompactionError("");

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
        throw new Error(data.error || "Could not preview compaction.");
      }

      setCompactionPreview(data);
    } catch (previewError) {
      setCompactionError(
        previewError instanceof Error ? previewError.message : "Could not preview compaction."
      );
    } finally {
      setCompactionLoading(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();

    if (!trimmed || sending) {
      return;
    }

    setSending(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          agent: selectedAgent,
          message: trimmed
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Message failed.");
      }

      setTranscripts((current) => ({
        ...current,
        [selectedAgent]: [...(current[selectedAgent] ?? []), ...(data.messages ?? [])]
      }));
    } catch (sendError) {
      setMessage(trimmed);
      setError(sendError instanceof Error ? sendError.message : "Message failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <h1>Agents</h1>
        <div className="agent-list">
          {agents.map((agent) => (
            <button
              className={`agent-button ${agent.name === selectedAgent ? "active" : ""}`}
              disabled={sending}
              key={agent.name}
              onClick={() => setSelectedAgent(agent.name)}
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
          health={health}
          onPreviewCompaction={previewCompaction}
        />
      </aside>

      <section className="main">
        <header className="header">
          <h2>{activeAgent?.display_name ?? selectedAgent}</h2>
          <p>{conversationLabel(selectedAgent)}</p>
        </header>

        <div className="transcript" ref={transcriptRef}>
          {loading ? <p className="empty">Loading seeded context...</p> : null}

          {!loading && activeMessages.length === 0 ? (
            <p className="empty">
              No messages yet. Send the first note and the server will wake this agent with their seeded context.
            </p>
          ) : null}

          {activeMessages.map((chatMessage) => (
            <article
              className={`message ${chatMessage.role}`}
              key={chatMessage.id ?? `${chatMessage.conversation_id}-${chatMessage.position}`}
            >
              <div className="message-meta">
                {chatMessage.role === "assistant"
                  ? activeAgent?.display_name ?? selectedAgent
                  : "Chris"}
              </div>
              {contentToText(chatMessage.content)}
            </article>
          ))}
        </div>

        <form className="composer" onSubmit={sendMessage}>
          {error ? <p className="error">{error}</p> : null}
          <div className="composer-row">
            <textarea
              disabled={loading || sending || agents.length === 0}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={`Message ${activeAgent?.display_name ?? selectedAgent}`}
              value={message}
            />
            <button
              className="send"
              disabled={loading || sending || !message.trim()}
              type="submit"
            >
              {sending ? "Sending" : "Send"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function RuntimeHealthPanel({
  activeHealth,
  compactionError,
  compactionLoading,
  compactionPreview,
  health,
  onPreviewCompaction
}: {
  activeHealth: AgentHealth | undefined;
  compactionError: string;
  compactionLoading: boolean;
  compactionPreview: CompactionPreview | null;
  health: Health | null;
  onPreviewCompaction: () => void;
}) {
  const envOk = health ? Object.values(health.env).every(Boolean) : false;
  const pressure = activeHealth?.compaction_pressure;

  return (
    <section className="health-panel" aria-label="Runtime health">
      <div className="health-heading">
        <h2>Runtime</h2>
        <span className={`status-dot ${activeHealth?.status === "ok" ? "ok" : "warn"}`} />
      </div>

      {activeHealth ? (
        <>
          <dl className="health-list">
            <div>
              <dt>Model</dt>
              <dd>{activeHealth.model}</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>{activeHealth.conversation.message_count}</dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>
                {activeHealth.memory.active_rows} active / {activeHealth.memory.core_rows} core
              </dd>
            </div>
            <div>
              <dt>Tools</dt>
              <dd>{health?.tools.count ?? 0}</dd>
            </div>
            <div>
              <dt>Rounds</dt>
              <dd>{health?.runtime.max_tool_rounds ?? "?"}</dd>
            </div>
            <div>
              <dt>Env</dt>
              <dd>{envOk ? "ready" : "check"}</dd>
            </div>
          </dl>

          <div className="pressure">
            <div className="pressure-row">
              <span>Compaction</span>
              <strong>{pressure?.level ?? "unknown"}</strong>
            </div>
            <div className="pressure-track">
              <span
                className={`pressure-fill ${pressure?.level ?? "low"}`}
                style={{ width: `${Math.min(100, Math.max(0, pressure?.percent ?? 0))}%` }}
              />
            </div>
            <p>{health?.compaction.status ?? "unknown"} · {health?.compaction.mode ?? "manual"}</p>
          </div>

          <button
            className="quiet-action"
            disabled={compactionLoading}
            onClick={onPreviewCompaction}
            type="button"
          >
            {compactionLoading ? "Previewing" : "Preview Blink"}
          </button>

          {compactionError ? <p className="health-error">{compactionError}</p> : null}

          {compactionPreview ? (
            <div className="compaction-preview">
              <p>
                <strong>{compactionPreview.mode}</strong>
              </p>
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
              <p>{compactionPreview.next_step}</p>
            </div>
          ) : null}

          <p className="health-time">Updated {health?.local_time ?? "unknown"}</p>
        </>
      ) : (
        <p className="health-empty">Health unavailable.</p>
      )}
    </section>
  );
}

function conversationLabel(agent: AgentName) {
  return `${agent}-main`;
}

function contentToText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (
          block &&
          typeof block === "object" &&
          "type" in block &&
          block.type === "text" &&
          "text" in block &&
          typeof block.text === "string"
        ) {
          return block.text;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  return JSON.stringify(content);
}
