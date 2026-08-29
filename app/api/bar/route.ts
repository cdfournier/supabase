import { NextResponse } from "next/server";
import { joinBar, leaveBar, loadBar, postBarMessage } from "@/lib/bar";
import { resolveBarAttachmentReferences } from "@/lib/source-material-upload";

type AttachmentInput = {
  id: string;
};

export async function GET() {
  try {
    return NextResponse.json(await loadBar());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown BAR error" },
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
      await joinBar(participant);
      return NextResponse.json(await loadBar());
    }

    if (action === "leave") {
      await leaveBar(participant);
      return NextResponse.json(await loadBar());
    }

    const content = String(body.content ?? body.message ?? "").trim();
    const attachments = normalizeAttachments(body.attachments);

    if (!content && !attachments.length) {
      return NextResponse.json({ error: "BAR message is required." }, { status: 400 });
    }

    const resolvedAttachments = await resolveBarAttachmentReferences(attachments);
    const posted = await postBarMessage({
      ...participant,
      content,
      attachments: resolvedAttachments
    });

    return NextResponse.json({ ...(await loadBar()), posted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown BAR error" },
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
