"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Catches any auth tokens / codes that landed in the URL via a magic
 * link or OAuth redirect — *regardless* of which flow Supabase chose:
 *
 *   - Query string:   ?code=XXX               (PKCE flow, handled by middleware)
 *   - URL fragment:   #access_token=...       (implicit flow, handled here)
 *
 * The Supabase dashboard's "Send Magic Link" admin action — the fallback
 * path when the in-app /auth/sign-in form is rate-limited on the free
 * tier — still uses the implicit flow. URL fragments never reach the
 * server, so middleware can't see them; we have to parse them in the
 * browser and explicitly hand them to supabase.auth.setSession().
 *
 * `@supabase/ssr`'s createBrowserClient is configured for PKCE by
 * default, so its auto-detection does NOT handle fragments. We do it
 * manually here.
 *
 * After consumption we clean the fragment out of the URL and either
 * refresh (so server components re-render with the new cookies) or
 * redirect to /admin (if the user landed on the homepage, which is
 * what dashboard-sent links do by default).
 */
export default function AuthSessionHandler() {
  const router = useRouter();

  useEffect(() => {
    const rawHash = window.location.hash;
    const rawQuery = window.location.search;

    // Only run when the URL looks like it came from an auth redirect.
    if (!rawHash.includes("access_token=") && !rawQuery.includes("code=")) {
      return;
    }

    let cancelled = false;

    (async () => {
      const supabase = getBrowserSupabase();

      // Implicit flow (fragment).
      if (rawHash.includes("access_token=")) {
        const params = new URLSearchParams(
          rawHash.startsWith("#") ? rawHash.slice(1) : rawHash,
        );
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");

        if (!access_token || !refresh_token) {
          console.warn("[auth-handler] fragment present but missing tokens");
          return;
        }

        const { error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });

        if (cancelled) return;

        if (error) {
          console.error("[auth-handler] setSession failed", error.message);
          return;
        }
      } else if (rawQuery.includes("code=")) {
        // PKCE flow should have been intercepted by middleware already.
        // If we somehow still see a `?code=` here, exchange it client-side
        // as a fallback.
        const code = new URLSearchParams(rawQuery).get("code");
        if (!code) return;
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (error) {
          console.error(
            "[auth-handler] exchangeCodeForSession failed",
            error.message,
          );
          return;
        }
      }

      // Strip the auth bits from the URL so they're not visible or
      // accidentally re-processed on reload.
      const clean = window.location.pathname + (rawQuery && !rawQuery.includes("code=") ? rawQuery : "");
      window.history.replaceState({}, "", clean || "/");

      // Landing on the homepage via a dashboard-sent link → nudge to /admin.
      // Otherwise just refresh so server components pick up the cookie.
      if (window.location.pathname === "/") {
        router.replace("/admin");
      } else {
        router.refresh();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
