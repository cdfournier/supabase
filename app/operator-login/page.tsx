"use client";

import { FormEvent, useState } from "react";

export default function OperatorLoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/operator/session", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ token })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not unlock operator access.");
      }

      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.assign(next.startsWith("/") ? next : "/");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Could not unlock operator access.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="operator-login-title">
        <p className="login-eyebrow">Operator Access</p>
        <h1 id="operator-login-title">Unlock Runtime</h1>
        <p>
          This runtime contains live Agent continuity data. Remote access needs the
          Operator token before any chat, health, upload, or tool route opens.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="operator-token">Operator token</label>
          <input
            autoComplete="current-password"
            autoFocus
            id="operator-token"
            onChange={(event) => setToken(event.target.value)}
            type="password"
            value={token}
          />
          {error ? <p className="error">{error}</p> : null}
          <button className="send" disabled={submitting || !token.trim()} type="submit">
            {submitting ? "Unlocking" : "Unlock"}
          </button>
        </form>
      </section>
    </main>
  );
}
