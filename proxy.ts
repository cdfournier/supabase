import { NextRequest, NextResponse } from "next/server";
import {
  OPERATOR_SESSION_COOKIE,
  isLocalHost,
  operatorAuthConfigured,
  operatorSessionCookieValid
} from "@/lib/operator-auth";

const PUBLIC_PATHS = new Set([
  "/operator-login",
  "/api/operator/session",
  "/api/bar/bridge",
  "/api/cafe/bridge",
  "/api/eyes/bridge",
  "/api/operator-note-wake-receipts/bridge",
  "/api/operator-notes/bridge",
  "/api/wake-arrivals/bridge",
  "/api/work-packets/bridge",
  "/api/work-packet-signals/bridge",
  "/api/live-sessions/bridge",
  "/api/live-sessions/bridge-deliveries"
]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!operatorAuthConfigured()) {
    if (isLocalHost(request.headers.get("host"))) {
      return NextResponse.next();
    }

    return deny(request, "Operator access token is not configured for remote access.", 503);
  }

  const cookieValue = request.cookies.get(OPERATOR_SESSION_COOKIE)?.value;

  if (await operatorSessionCookieValid(cookieValue)) {
    return NextResponse.next();
  }

  return deny(request, "Operator authentication required.", 401);
}

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  );
}

function deny(request: NextRequest, message: string, status: 401 | 503) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status });
  }

  if (status === 503) {
    return new NextResponse(message, {
      status,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/operator-login";
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"]
};
