import { NextResponse } from "next/server";
import { joinEyes, leaveEyes, loadEyes, postEyesMessage } from "@/lib/eyes";
import { resolveEyesFrameReferences } from "@/lib/source-material-upload";

type AttachmentInput = {
  id: string;
};

export async function GET() {
  try {
    return NextResponse.json(await loadEyes());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown EYES error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? "post");
    const participant = {
      participant_id: String(body.participant_id ?? "operator:chris"),
      participant_type: body.participant_type === "agent" ? "agent" as const : "operator" as const,
      display_name: String(body.display_name ?? "Chris"),
      source: "operator_ui",
      metadata: {
        adapter: "operator_browser"
      }
    };

    if (action === "join") {
      await joinEyes(participant);
      return NextResponse.json(await loadEyes());
    }

    if (action === "leave") {
      await leaveEyes(participant);
      return NextResponse.json(await loadEyes());
    }

    const content = String(body.content ?? body.message ?? "").trim();
    const frames = normalizeAttachments(body.frames ?? body.attachments);

    if (!content && !frames.length) {
      return NextResponse.json({ error: "EYES message or frame is required." }, { status: 400 });
    }

    const resolvedFrames = await resolveEyesFrameReferences(frames);
    const posted = await postEyesMessage({
      ...participant,
      content,
      kind: action === "observe" ? "observation" : "message",
      frames: resolvedFrames
    });

    return NextResponse.json({ ...(await loadEyes()), posted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown EYES error" },
      { status: 500 }
    );
  }
}

function normalizeAttachments(value: unknown): AttachmentInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || !("id" in item)) {
        return null;
      }

      const id = String(item.id ?? "").trim();

      return id ? { id } : null;
    })
    .filter((item): item is AttachmentInput => Boolean(item));
}
