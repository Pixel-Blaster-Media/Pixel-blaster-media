import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/safe-next-path";
import { getServerSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash")?.trim() ?? "";
  const next = url.searchParams.get("next") ?? "/admin";

  if (!tokenHash) {
    return signInRedirect(url, "invalid_invitation");
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (error) {
    console.warn("[auth.confirm] invitation verification failed", error.message);
    return signInRedirect(url, "expired");
  }

  return NextResponse.redirect(new URL(safeNextPath(next), url.origin));
}

function signInRedirect(url: URL, error: string): NextResponse {
  const destination = new URL("/auth/sign-in", url.origin);
  destination.searchParams.set("error", error);
  return NextResponse.redirect(destination);
}
