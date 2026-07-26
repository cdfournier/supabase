import { NextResponse } from "next/server";
import { loadCafe, postOperatorCafeMessage } from "@/lib/cafe";
import { getSupabaseAdmin } from "@/lib/supabase";

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

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const posted = await postOperatorCafeMessage(supabase, message);
    const cafe = await loadCafe(supabase);

    return NextResponse.json({ ...cafe, posted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
