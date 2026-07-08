import { NextResponse } from "next/server";
import { isAgentName } from "@/lib/agent-context";
import { compileCompactionProposal } from "@/lib/compaction-compile";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const agent = String(body.agent ?? "");

    if (!isAgentName(agent)) {
      return NextResponse.json({ error: "Choose soren or varro." }, { status: 400 });
    }

    return NextResponse.json(
      await compileCompactionProposal({
        agent,
        dryRun: body.dry_run === true,
        maxChars: body.max_chars,
        requestSource: "operator_compaction_compile"
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown compaction compile error" },
      { status: 500 }
    );
  }
}
