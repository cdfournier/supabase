import { randomUUID } from "node:crypto";
import { RuntimeTurnCancelController } from "./free-moment-cancel-controller.ts";

export type ChatTurnStatus =
  | "running"
  | "cancellation_requested"
  | "force_stopping"
  | "completed"
  | "cancelled"
  | "forced_stop"
  | "failed";

export type ChatTurnPhase = "preparing" | "model" | "tool" | "wrap_up" | "finished";

export type ChatTurnRunContext<Agent extends string, Result, Activity> = {
  turn: ChatTurnSnapshot<Agent, Result, Activity>;
  cancellation: RuntimeTurnCancelController;
  reportActivity: (activity: Activity) => void;
  reportPhase: (phase: Exclude<ChatTurnPhase, "preparing" | "finished">) => void;
};

export type ChatTurnSnapshot<Agent extends string, Result, Activity = unknown> = {
  turn_id: string;
  agent: Agent;
  status: ChatTurnStatus;
  phase: ChatTurnPhase;
  started_at: string;
  finished_at: string | null;
  cancellation_requested_at: string | null;
  cancellation_mode: "graceful" | "force" | null;
  force_stop_available: boolean;
  activity: Activity[];
  result?: Result;
  error?: string;
};

const COMPLETED_TURN_RETENTION_MS = 30 * 60 * 1000;

/**
 * Small in-process queue for interactive agent turns. The work intentionally
 * survives the browser request, while per-agent serialization keeps two
 * operator messages from racing for the same conversation position.
 */
export class ChatTurnStore<Agent extends string, Result, Activity = unknown> {
  private readonly turns = new Map<string, ChatTurnSnapshot<Agent, Result, Activity>>();
  private readonly activeTurnByAgent = new Map<Agent, string>();
  private readonly cancellationByTurn = new Map<string, RuntimeTurnCancelController>();

  start(
    agent: Agent,
    run: (context: ChatTurnRunContext<Agent, Result, Activity>) => Promise<Result>
  ) {
    this.pruneCompletedTurns();

    const activeTurnId = this.activeTurnByAgent.get(agent);
    if (activeTurnId) {
      const activeTurn = this.turns.get(activeTurnId);
      if (activeTurn?.status === "running") {
        return { turn: activeTurn, started: false };
      }
      this.activeTurnByAgent.delete(agent);
    }

    const turn: ChatTurnSnapshot<Agent, Result, Activity> = {
      turn_id: randomUUID(),
      agent,
      status: "running",
      phase: "preparing",
      started_at: new Date().toISOString(),
      finished_at: null,
      cancellation_requested_at: null,
      cancellation_mode: null,
      force_stop_available: false,
      activity: []
    };
    const cancellation = new RuntimeTurnCancelController();

    this.turns.set(turn.turn_id, turn);
    this.activeTurnByAgent.set(agent, turn.turn_id);
    this.cancellationByTurn.set(turn.turn_id, cancellation);

    void Promise.resolve()
      .then(() =>
        run({
          turn,
          cancellation,
          reportActivity: (activity) => {
            turn.activity.push(activity);
          },
          reportPhase: (phase) => {
            turn.phase = phase;
          }
        })
      )
      .then((result) => {
        turn.status = cancellation.forceStopRequested
          ? "forced_stop"
          : cancellation.gracefulStopRequested
            ? "cancelled"
            : "completed";
        turn.phase = "finished";
        turn.finished_at = new Date().toISOString();
        turn.result = result;
        this.releaseAgent(agent, turn.turn_id);
      })
      .catch((error) => {
        turn.status = cancellation.forceStopRequested ? "forced_stop" : "failed";
        turn.phase = "finished";
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

  active() {
    this.pruneCompletedTurns();
    return [...this.activeTurnByAgent.values()]
      .map((turnId) => this.turns.get(turnId))
      .filter((turn): turn is ChatTurnSnapshot<Agent, Result, Activity> => Boolean(turn));
  }

  cancel(turnId: string, mode: "graceful" | "force", graceMs: number) {
    const turn = this.turns.get(turnId);
    const cancellation = this.cancellationByTurn.get(turnId);

    if (!turn || !cancellation || turn.finished_at) {
      return { turn: turn ?? null, changed: false, error: "That turn is no longer active." };
    }

    if (mode === "force") {
      const changed = cancellation.requestForceStop();
      if (changed) {
        turn.status = "force_stopping";
        turn.cancellation_requested_at ??= new Date().toISOString();
        turn.cancellation_mode = "force";
        turn.force_stop_available = false;
      }
      return { turn, changed, error: changed ? null : "Force stop was already requested." };
    }

    const changed = cancellation.requestGracefulStop(graceMs, () => {
      if (!turn.finished_at && turn.status === "cancellation_requested") {
        turn.force_stop_available = true;
      }
    });
    if (changed) {
      turn.status = "cancellation_requested";
      turn.cancellation_requested_at = cancellation.cancellationRequestedAt;
      turn.cancellation_mode = "graceful";
    }
    return { turn, changed, error: changed ? null : "Cancellation was already requested." };
  }

  private releaseAgent(agent: Agent, turnId: string) {
    if (this.activeTurnByAgent.get(agent) === turnId) {
      this.activeTurnByAgent.delete(agent);
    }
    this.cancellationByTurn.get(turnId)?.clear();
    this.cancellationByTurn.delete(turnId);
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
