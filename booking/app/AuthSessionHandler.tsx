"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Catches any auth tokens / codes that landed in the URL via a magic
 * link or OAuth redirect — *regardless* of which flow Supabase chose:
 *
 *   - Query string:   ?code=XXX               (PKCE flow, new)
 *   - URL fragment:   #access_token=...       (implicit flow, legacy;
 *                                              what the Supabase
 *                                              dashboard's "Send Magic
 *                                              Link" action still uses
 *                                              in some accounts)
 *
 * Server-side middleware already covers the `?code=` case, but URL
 * fragments never reach the server. This component runs in the browser
 * on every page and lets @supabase/ssr's built-in `detectSessionInUrl`
 * consume the tokens and set session cookies transparently.
 *
 * After consumption, we cleanly rewrite the URL (remove the fragment)
 * and refresh the route so server components re-render with the new
 * session cookies. If the user was trying to hit /admin or /portal,
 * they'll now pass the middleware gate and land where they intended.
 */
export default function AuthSessionHandler() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    const query = window.location.search;

    const hasTokenFragment = hash.includes("access_token=") || hash.includes("error=");
    const hasCodeQuery = query.includes("code=");

    if (!hasTokenFragment && !hasCodeQuery) return;

    let cancelled = false;

    (async () => {
      const supabase = getBrowserSupabase();

      // The browser client auto-processes tokens in the URL on
      // construction (detectSessionInUrl defaults to true). Verify by
      // asking for the current session — if it's now populated, we're
      // signed in.
      const { data, error } = await supabase.auth.getSession();

      if (cancelled) return;

      if (error) {
        console.error("[auth-handler] getSession error", error.message);
        return;
      }

      if (data.session) {
        // Clean the URL (strip any lingering fragment or code) and
        // refresh so server components pick up the new cookie.
        const clean = window.location.pathname + (query && !hasCodeQuery ? query : "");
        window.history.replaceState({}, "", clean || "/");
        router.refresh();

        // If the user landed on the homepage via a dashboard-initiated
        // link, nudge them to admin so it actually feels like they
        // signed in.
        if (window.location.pathname === "/") {
          router.replace("/admin");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
