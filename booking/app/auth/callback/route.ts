import { NextResponse, type NextRequest } from "next/server";

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
  const next = url.searchParams.get("next") ?? "/admin";

  if (!code) {
    return NextResponse.redirect(new URL("/auth/sign-in", url.origin));
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth] exchangeCodeForSession failed", error.message);
    const failed = new URL("/auth/sign-in", url.origin);
    failed.searchParams.set("error", "expired");
    return NextResponse.redirect(failed);
  }

  return NextResponse.redirect(new URL(safeNextPath(next), url.origin));
}

function safeNextPath(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/admin";
  }
  return next;
}
