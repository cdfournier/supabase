import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { sendAgentMessage, type RuntimeToolActivity } from "@/lib/chat-runtime";
import {
  ChatTurnStore,
  type ChatTurnSnapshot,
  type ChatTurnStatus
} from "@/lib/chat-turn-store";
import {
  finishRuntimeTurnRun,
  markRuntimeTurnCancellation,
  markRuntimeTurnWrappingUp,
  reconcileInterruptedRuntimeTurns,
  startRuntimeTurnRun,
  updateRuntimeTurnActivity
} from "@/lib/runtime-turn-runs";
import type { AttachmentInput } from "@/lib/source-material-upload";

type ChatTurnResult = Awaited<ReturnType<typeof sendAgentMessage>>;

export type { ChatTurnStatus };
export type RuntimeChatTurnSnapshot = ChatTurnSnapshot<AgentName, ChatTurnResult, RuntimeToolActivity>;

type StartInput = {
  agent: AgentName;
  message: string;
  attachments: AttachmentInput[];
};

type RuntimeGlobal = typeof globalThis & {
  __runtimeChatTurnStore?: ChatTurnStore<AgentName, ChatTurnResult, RuntimeToolActivity>;
  __runtimeChatTurnReceiptsReconciled?: boolean;
};

const CHAT_TURN_CANCEL_GRACE_MS = 60_000;

function chatTurnStore() {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal.__runtimeChatTurnStore ??= new ChatTurnStore<
    AgentName,
    ChatTurnResult,
    RuntimeToolActivity
  >();
  if (!runtimeGlobal.__runtimeChatTurnReceiptsReconciled) {
    runtimeGlobal.__runtimeChatTurnReceiptsReconciled = true;
    void reconcileInterruptedRuntimeTurns().catch((error) => {
      console.error("Could not reconcile interrupted runtime turns.", error);
    });
  }
  return runtimeGlobal.__runtimeChatTurnStore;
}

export function startChatTurn(input: StartInput) {
  return chatTurnStore().start(input.agent, async ({ cancellation, reportActivity, reportPhase, turn }) => {
    await startRuntimeTurnRun({ id: turn.turn_id, agent: input.agent, source: "chat_api" });

    try {
      const result = await sendAgentMessage(input.agent, input.message, {
        turnId: turn.turn_id,
        attachments: input.attachments,
        onToolActivity: (activity) => {
          reportActivity(activity);
          void updateRuntimeTurnActivity(turn.turn_id, "tool", activityAsRecord(activity)).catch((error) => {
            console.error("Could not persist runtime tool activity.", error);
          });
        },
        cancellation: {
          signal: cancellation.abortController.signal,
          isCancellationRequested: () => cancellation.gracefulStopRequested,
          onPhaseChange: (phase) => {
            reportPhase(phase);
            if (phase === "wrap_up") {
              void markRuntimeTurnWrappingUp(turn.turn_id).catch((error) => {
                console.error("Could not persist runtime turn wrap-up.", error);
              });
              return;
            }
            void updateRuntimeTurnActivity(turn.turn_id, phase, { phase, message: phaseLabel(phase) }).catch((error) => {
              console.error("Could not persist runtime turn phase.", error);
            });
          }
        }
      });

      await finishRuntimeTurnRun(
        turn.turn_id,
        cancellation.forceStopRequested
          ? "forced_stop"
          : cancellation.gracefulStopRequested
            ? "cancelled"
            : "completed"
      );
      return result;
    } catch (error) {
      await finishRuntimeTurnRun(turn.turn_id, cancellation.forceStopRequested ? "forced_stop" : "failed", {
        error: error instanceof Error ? error.message : "Unknown runtime turn error"
      });
      throw error;
    }
  });
}

export function getChatTurn(turnId: string) {
  return chatTurnStore().get(turnId);
}

export function getActiveChatTurns() {
  return chatTurnStore().active();
}

export async function cancelChatTurn(turnId: string, mode: "graceful" | "force", reason?: string) {
  const outcome = chatTurnStore().cancel(turnId, mode, CHAT_TURN_CANCEL_GRACE_MS);
  if (outcome.changed) {
    await markRuntimeTurnCancellation(turnId, mode, reason);
  }
  return outcome;
}

function activityAsRecord(activity: RuntimeToolActivity) {
  return JSON.parse(JSON.stringify(activity)) as Record<string, unknown>;
}

function phaseLabel(phase: "model" | "tool" | "wrap_up") {
  if (phase === "model") {
    return "Waiting for the model.";
  }
  if (phase === "tool") {
    return "Using a tool.";
  }
  return "Writing a closing note.";
}
