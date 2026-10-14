import { randomUUID } from "node:crypto";

export type ChatTurnStatus = "running" | "completed" | "failed";

export type ChatTurnSnapshot<Agent extends string, Result> = {
  turn_id: string;
  agent: Agent;
  status: ChatTurnStatus;
  started_at: string;
  finished_at: string | null;
  result?: Result;
  error?: string;
};

const COMPLETED_TURN_RETENTION_MS = 30 * 60 * 1000;

/**
 * Small in-process queue for interactive agent turns. The work intentionally
 * survives the browser request, while per-agent serialization keeps two
 * operator messages from racing for the same conversation position.
 */
export class ChatTurnStore<Agent extends string, Result> {
  private readonly turns = new Map<string, ChatTurnSnapshot<Agent, Result>>();
  private readonly activeTurnByAgent = new Map<Agent, string>();

  start(agent: Agent, run: () => Promise<Result>) {
    this.pruneCompletedTurns();

    const activeTurnId = this.activeTurnByAgent.get(agent);
    if (activeTurnId) {
      const activeTurn = this.turns.get(activeTurnId);
      if (activeTurn?.status === "running") {
        return { turn: activeTurn, started: false };
      }
      this.activeTurnByAgent.delete(agent);
    }

    const turn: ChatTurnSnapshot<Agent, Result> = {
      turn_id: randomUUID(),
      agent,
      status: "running",
      started_at: new Date().toISOString(),
      finished_at: null
    };

    this.turns.set(turn.turn_id, turn);
    this.activeTurnByAgent.set(agent, turn.turn_id);

    void Promise.resolve()
      .then(run)
      .then((result) => {
        turn.status = "completed";
        turn.finished_at = new Date().toISOString();
        turn.result = result;
        this.releaseAgent(agent, turn.turn_id);
      })
      .catch((error) => {
        turn.status = "failed";
        turn.finished_at = new Date().toISOString();
        turn.error = error instanceof Error ? error.message : "Unknown error while running chat turn.";
        this.releaseAgent(agent, turn.turn_id);
      });

    return { turn, started: true };
  }

  get(turnId: string) {
    this.pruneCompletedTurns();
    return this.turns.get(turnId) ?? null;
  }

  private releaseAgent(agent: Agent, turnId: string) {
    if (this.activeTurnByAgent.get(agent) === turnId) {
      this.activeTurnByAgent.delete(agent);
    }
  }

  private pruneCompletedTurns() {
    const cutoff = Date.now() - COMPLETED_TURN_RETENTION_MS;

    for (const [turnId, turn] of this.turns) {
      if (turn.status === "running" || !turn.finished_at) {
        continue;
      }

      if (Date.parse(turn.finished_at) < cutoff) {
        this.turns.delete(turnId);
      }
    }
  }
}
