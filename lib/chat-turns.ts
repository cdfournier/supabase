import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { sendAgentMessage } from "@/lib/chat-runtime";
import {
  ChatTurnStore,
  type ChatTurnSnapshot,
  type ChatTurnStatus
} from "@/lib/chat-turn-store";
import type { AttachmentInput } from "@/lib/source-material-upload";

type ChatTurnResult = Awaited<ReturnType<typeof sendAgentMessage>>;

export type { ChatTurnStatus };
export type RuntimeChatTurnSnapshot = ChatTurnSnapshot<AgentName, ChatTurnResult>;

type StartInput = {
  agent: AgentName;
  message: string;
  attachments: AttachmentInput[];
};

type RuntimeGlobal = typeof globalThis & {
  __runtimeChatTurnStore?: ChatTurnStore<AgentName, ChatTurnResult>;
};

function chatTurnStore() {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal.__runtimeChatTurnStore ??= new ChatTurnStore<AgentName, ChatTurnResult>();
  return runtimeGlobal.__runtimeChatTurnStore;
}

export function startChatTurn(input: StartInput) {
  return chatTurnStore().start(input.agent, () =>
    sendAgentMessage(input.agent, input.message, { attachments: input.attachments })
  );
}

export function getChatTurn(turnId: string) {
  return chatTurnStore().get(turnId);
}
