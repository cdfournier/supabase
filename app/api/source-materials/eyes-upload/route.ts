import { NextResponse } from "next/server";
import { uploadFilesAsEyesSourceMaterials, uploadLimits } from "@/lib/source-material-upload";

export async function POST(request: Request) {
  try {
    const body = await request.formData();
    const files = body.getAll("files").filter((value): value is File => value instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "Attach at least one frame." }, { status: 400 });
    }

    const materials = await uploadFilesAsEyesSourceMaterials(files);

    return NextResponse.json({
      materials,
      limits: uploadLimits()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown EYES upload error" },
      { status: 500 }
    );
  }
}
