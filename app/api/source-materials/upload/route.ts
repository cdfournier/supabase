import { NextResponse } from "next/server";
import { isAgentName } from "@/lib/agent-context";
import { uploadFilesAsSourceMaterials, uploadLimits } from "@/lib/source-material-upload";

export async function POST(request: Request) {
  try {
    const body = await request.formData();
    const agent = String(body.get("agent") ?? "");

    if (!isAgentName(agent)) {
      return NextResponse.json({ error: "Choose soren or varro." }, { status: 400 });
    }

    const files = body.getAll("files").filter((value): value is File => value instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "Attach at least one file." }, { status: 400 });
    }

    const materials = await uploadFilesAsSourceMaterials(agent, files);

    return NextResponse.json({
      materials,
      limits: uploadLimits()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown upload error" },
      { status: 500 }
    );
  }
}
