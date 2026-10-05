import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const frameId = id.trim();

  if (!frameId) {
    return NextResponse.json({ error: "EYES frame not found." }, { status: 404 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: frame, error: frameError } = await supabase
      .from("source_materials")
      .select("bucket, storage_path, mime_type, size_bytes")
      .eq("id", frameId)
      .eq("status", "active")
      .eq("uploaded_via", "eyes_upload")
      .maybeSingle();

    if (frameError) {
      throw new Error(frameError.message);
    }

    if (!frame?.bucket || !frame.storage_path) {
      return NextResponse.json({ error: "EYES frame not found." }, { status: 404 });
    }

    const { data: file, error: fileError } = await supabase.storage
      .from(String(frame.bucket))
      .download(String(frame.storage_path));

    if (fileError || !file) {
      throw new Error(fileError?.message ?? "EYES frame is unavailable.");
    }

    return new NextResponse(file, {
      headers: {
        "cache-control": "private, max-age=300",
        "content-type": String(frame.mime_type || file.type || "application/octet-stream"),
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load EYES frame." },
      { status: 500 }
    );
  }
}
