export const OPERATOR_SESSION_COOKIE = "runtime_operator_session";
export const OPERATOR_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export function operatorAuthConfigured() {
  return Boolean(operatorAccessToken());
}

export function operatorAccessToken() {
  return process.env.OPERATOR_ACCESS_TOKEN?.trim() ?? "";
}

export function isLocalHost(hostHeader: string | null) {
  const rawHost = (hostHeader ?? "").split(",")[0]?.trim() ?? "";
  const host = rawHost
    .replace(/:\d+$/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();

  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}

export async function operatorSessionValue() {
  const token = operatorAccessToken();

  if (!token) {
    return "";
  }

  return signOperatorToken(token);
}

export async function operatorTokenMatches(input: string) {
  const expected = await operatorSessionValue();

  if (!expected) {
    return false;
  }

  return (await signOperatorToken(input)) === expected;
}

export async function operatorSessionCookieValid(cookieValue: string | undefined) {
  const expected = await operatorSessionValue();

  return Boolean(cookieValue && expected && cookieValue === expected);
}

async function signOperatorToken(token: string) {
  const secret = process.env.OPERATOR_AUTH_SECRET?.trim() || operatorAccessToken();
  const payload = `${secret}:${token.trim()}`;
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
