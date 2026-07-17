import { NextResponse, type NextRequest } from "next/server";

import { safePostAuthPath } from "@/lib/auth/account-destination";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * OAuth-style callback for Supabase magic links.
 *
 * Supabase appends `?code=...` to the redirect URL we set in
 * `signInWithOtp.options.emailRedirectTo`. We exchange that code for a
 * session (cookies are set by the supabase server client) and forward the
 * user on to wherever they were trying to go (`?next=...`).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error");
  const next = safePostAuthPath(url.searchParams.get("next"));

  if (providerError || !code) {
    const failed = new URL("/auth/sign-in", url.origin);
    failed.searchParams.set(
      "error",
      providerError ? "callback_failed" : "expired",
    );
    applyAudience(failed, next, url.origin);
    return NextResponse.redirect(failed);
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth] exchangeCodeForSession failed", error.message);
    const failed = new URL("/auth/sign-in", url.origin);
    failed.searchParams.set("error", "expired");
    applyAudience(failed, next, url.origin);
    return NextResponse.redirect(failed);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

function applyAudience(destination: URL, next: string, origin: string): void {
  const continuation = new URL(next, origin);
  const audience = continuation.searchParams.get("audience");
  if (audience === "company" || audience === "realtor") {
    destination.searchParams.set("audience", audience);
  }
  const requested = safePostAuthPath(continuation.searchParams.get("next"));
  if (requested !== "/auth/continue") {
    destination.searchParams.set("next", requested);
  }
}
