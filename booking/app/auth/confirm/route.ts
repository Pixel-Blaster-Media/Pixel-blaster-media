import { NextResponse, type NextRequest } from "next/server";

import { safeAppOrigin, safeNextPath } from "@/lib/auth/safe-next-path";
import { getServerSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const redirectOrigin = safeAppOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    url.origin,
  );
  const tokenHash = url.searchParams.get("token_hash")?.trim() ?? "";
  const next = url.searchParams.get("next") ?? "/admin";

  if (!tokenHash) {
    return signInRedirect(redirectOrigin, "invalid_invitation");
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (error) {
    console.warn("[auth.confirm] invitation verification failed", error.message);
    return signInRedirect(redirectOrigin, "expired");
  }

  return NextResponse.redirect(new URL(safeNextPath(next), redirectOrigin));
}

function signInRedirect(origin: string, error: string): NextResponse {
  const destination = new URL("/auth/sign-in", origin);
  destination.searchParams.set("error", error);
  return NextResponse.redirect(destination);
}
