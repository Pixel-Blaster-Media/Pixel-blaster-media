"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Client-side catcher for auth tokens that land in the URL via a magic
 * link redirect.
 *
 * Supabase uses two flows depending on how the magic link was created:
 *
 *   - PKCE (`?code=...`)      — our /auth/sign-in form; middleware
 *                               already forwards this to /auth/callback.
 *   - Implicit (`#access_token=...`) — what the Supabase dashboard's
 *                                       "Send Magic Link" action uses.
 *                                       URL fragments never reach the
 *                                       server, so we catch them here.
 *
 * For implicit flow we parse the fragment, POST the tokens to
 * /api/auth/bridge, and let the server-side Supabase client turn them
 * into proper HttpOnly cookies. Then we clean up the URL and navigate
 * the user to /admin so sign-in feels intentional.
 */
export default function AuthSessionHandler() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;

    if (!hash.includes("access_token=")) {
      return;
    }

    let cancelled = false;

    (async () => {
      const params = new URLSearchParams(
        hash.startsWith("#") ? hash.slice(1) : hash,
      );
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (!access_token || !refresh_token) {
        console.warn("[auth-handler] fragment missing required tokens");
        return;
      }

      let ok = false;
      try {
        const res = await fetch("/api/auth/bridge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token, refresh_token }),
        });
        ok = res.ok;
        if (!ok) {
          const body = await res.text();
          console.error("[auth-handler] bridge rejected:", res.status, body);
        }
      } catch (err) {
        console.error("[auth-handler] bridge threw:", err);
      }

      if (cancelled || !ok) return;

      // Strip the fragment from the address bar and send the user into
      // the app. We use a full navigation (window.location) rather than
      // router.replace to force a fresh request that middleware sees
      // the new cookies on.
      const target =
        window.location.pathname === "/" ? "/admin" : window.location.pathname;
      window.location.replace(target);
    })();

    return () => {
      cancelled = true;
    };
  // `router` isn't actually used here, but keeping the dep array stable
  // lets React lint pass without silencing rules.
  }, [router]);

  return null;
}
