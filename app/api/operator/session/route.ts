import { NextResponse } from "next/server";
import {
  OPERATOR_SESSION_COOKIE,
  OPERATOR_SESSION_MAX_AGE_SECONDS,
  operatorAuthConfigured,
  operatorSessionValue,
  operatorTokenMatches
} from "@/lib/operator-auth";

export async function POST(request: Request) {
  if (!operatorAuthConfigured()) {
    return NextResponse.json(
      { error: "OPERATOR_ACCESS_TOKEN is not configured." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const token = String(body.token ?? "");

  if (!(await operatorTokenMatches(token))) {
    return NextResponse.json({ error: "Invalid operator token." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(OPERATOR_SESSION_COOKIE, await operatorSessionValue(), {
    httpOnly: true,
    maxAge: OPERATOR_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(OPERATOR_SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });

  return response;
}
