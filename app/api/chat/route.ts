import { NextResponse } from "next/server";
import { isAgentName } from "@/lib/agent-context";
import { EmptyAssistantResponseError, sendAgentMessage } from "@/lib/chat-runtime";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const agent = String(body.agent ?? "");
    const message = String(body.message ?? "").trim();

    if (!isAgentName(agent)) {
      return NextResponse.json({ error: "Choose soren or varro." }, { status: 400 });
    }

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    return NextResponse.json(await sendAgentMessage(agent, message));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof EmptyAssistantResponseError ? 502 : 500 }
    );
  }
}
