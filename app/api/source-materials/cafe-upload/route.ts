import { NextResponse } from "next/server";
import { uploadFilesAsCafeSourceMaterials, uploadLimits } from "@/lib/source-material-upload";

export async function POST(request: Request) {
  try {
    const body = await request.formData();
    const files = body.getAll("files").filter((value): value is File => value instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "Attach at least one file." }, { status: 400 });
    }

    const materials = await uploadFilesAsCafeSourceMaterials(files);

    return NextResponse.json({
      materials,
      limits: uploadLimits()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Cafe upload error" },
      { status: 500 }
    );
  }
}
