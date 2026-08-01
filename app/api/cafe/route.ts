import { NextResponse } from "next/server";
import { loadCafe, postOperatorCafeMessage } from "@/lib/cafe";
import { resolveCafeAttachmentReferences } from "@/lib/source-material-upload";
import { getSupabaseAdmin } from "@/lib/supabase";

type AttachmentInput = {
  id: string;
};

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    return NextResponse.json(await loadCafe(supabase));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = String(body.message ?? "").trim();
    const attachments = normalizeAttachments(body.attachments);

    if (!message && !attachments.length) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const resolvedAttachments = await resolveCafeAttachmentReferences(attachments);
    const posted = await postOperatorCafeMessage(supabase, message, resolvedAttachments);
    const cafe = await loadCafe(supabase);

    return NextResponse.json({ ...cafe, posted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
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
