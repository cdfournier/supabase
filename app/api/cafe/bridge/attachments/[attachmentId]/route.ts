import { NextResponse } from "next/server";
import {
  markCafeAttachmentDelivered,
  resolveCafeAttachmentDelivery
} from "@/lib/cafe";
import {
  authorizeBridge,
  bridgeErrorStatus,
  bridgeParticipantFromRequest
} from "@/lib/bridge-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

type RouteContext = {
  params: Promise<{ attachmentId: string }>;
};

// The bridge deliberately streams bytes only after both the bridge token and
// the named Cafe participant have been verified. It never exposes a storage
// URL or a long-lived signed URL to an external participant.
export async function GET(request: Request, context: RouteContext) {
  const auth = authorizeBridge(request, "Cafe attachment bridge");

  if (auth) {
    return auth;
  }

  try {
    const participantId = bridgeParticipantFromRequest(request);
    const { attachmentId } = await context.params;
    const { delivery, attachment } = await resolveCafeAttachmentDelivery(
      getSupabaseAdmin(),
      attachmentId,
      participantId
    );

    if (delivery.delivery_method !== "external_bridge") {
      return NextResponse.json(
        { error: "This Cafe attachment is delivered through a different participant adapter." },
        { status: 403 }
      );
    }

    const { data, error } = await getSupabaseAdmin().storage
      .from(String(attachment.bucket))
      .download(String(attachment.storage_path));

    if (error) {
      throw new Error(`Could not download Cafe attachment: ${error.message}`);
    }

    await markCafeAttachmentDelivered(getSupabaseAdmin(), delivery.id);

    return new NextResponse(data, {
      headers: {
        "content-type": attachment.mime_type ?? "application/octet-stream",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.title)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}
