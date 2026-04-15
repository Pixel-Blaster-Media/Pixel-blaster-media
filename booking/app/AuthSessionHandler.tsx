"use client";

import { useEffect, useState } from "react";

type Status =
  | { state: "idle" }
  | { state: "detected" }
  | { state: "bridging" }
  | { state: "redirecting" }
  | { state: "error"; message: string };

/**
 * Client-side catcher for auth tokens that land in the URL via a magic
 * link redirect.
 *
 * Supabase uses two flows depending on how the magic link was created:
 *
 *   - PKCE (`?code=...`)        — our /auth/sign-in form; middleware
 *                                 already forwards this to /auth/callback.
 *   - Implicit (`#access_token=...`) — what the Supabase dashboard's
 *                                       "Send Magic Link" action uses.
 *                                       URL fragments never reach the
 *                                       server, so we catch them here.
 *
 * For implicit flow we parse the fragment, POST the tokens to
 * /api/auth/bridge, and let the server-side Supabase client turn them
 * into proper HttpOnly cookies. Then we do a full-page navigation so
 * middleware re-runs with the fresh cookies.
 *
 * While processing, we render a visible status banner so deploy-time
 * issues are self-diagnosing for non-technical operators.
 */
export default function AuthSessionHandler() {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    const hash = window.location.hash;

    if (!hash.includes("access_token=")) {
      return;
    }

    setStatus({ state: "detected" });
    let cancelled = false;

    (async () => {
      const params = new URLSearchParams(
        hash.startsWith("#") ? hash.slice(1) : hash,
      );
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (!access_token || !refresh_token) {
        setStatus({
          state: "error",
          message: "Magic link missing required tokens.",
        });
        return;
      }

      setStatus({ state: "bridging" });

      let ok = false;
      let errorMessage = "Unknown error.";
      try {
        const res = await fetch("/api/auth/bridge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token, refresh_token }),
        });
        if (res.ok) {
          ok = true;
        } else {
          const body = await res.text();
          errorMessage = `Bridge ${res.status}: ${body.slice(0, 200)}`;
        }
      } catch (err) {
        errorMessage =
          err instanceof Error ? err.message : "Network call failed.";
      }

      if (cancelled) return;

      if (!ok) {
        setStatus({ state: "error", message: errorMessage });
        return;
      }

      setStatus({ state: "redirecting" });

      const target =
        window.location.pathname === "/" ? "/admin" : window.location.pathname;
      // Full-page navigation forces middleware to re-read cookies server-side.
      window.location.replace(target);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (status.state === "idle") return null;

  const label: Record<Status["state"], string> = {
    idle: "",
    detected: "Magic link detected…",
    bridging: "Signing you in…",
    redirecting: "Welcome back — redirecting…",
    error: "Sign-in failed",
  };
  const isError = status.state === "error";

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        padding: "10px 16px",
        borderRadius: 8,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 14,
        fontWeight: 500,
        background: isError ? "rgba(239, 68, 68, 0.9)" : "rgba(34, 164, 181, 0.9)",
        color: "#fff",
        boxShadow: "0 6px 24px -6px rgba(0,0,0,0.4)",
        maxWidth: "90vw",
      }}
    >
      {label[status.state]}
      {isError && status.state === "error" ? (
        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 400 }}>
          {status.message}
        </div>
      ) : null}
    </div>
  );
}
