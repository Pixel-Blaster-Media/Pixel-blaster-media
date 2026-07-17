import { NextResponse, type NextRequest } from "next/server";

import {
  createRecoveryGrant,
  RECOVERY_GRANT_COOKIE,
  verifyRecoveryFlowToken,
} from "@/lib/auth/recovery-flow";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof getServerSupabase>>;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const flow = verifyRecoveryFlowToken(url.searchParams.get("flow"));
  if (!code || !flow) return resetFailure(null, request, url, "expired");

  let supabase: ServerSupabase | null = null;
  try {
    supabase = await getServerSupabase();
    const exchanged = await supabase.auth.exchangeCodeForSession(code);
    const user = exchanged.data.user;
    if (
      exchanged.error ||
      !user ||
      user.email?.trim().toLowerCase() !== flow.email
    ) {
      if (exchanged.error) {
        console.error("[auth/recovery] code exchange failed", exchanged.error.message);
      }
      return resetFailure(supabase, request, url, "expired");
    }

    const grant = createRecoveryGrant(user.id);
    const persisted = await getServiceSupabase()
      .from("auth_recovery_grants")
      .insert({
        jti_hash: grant.jtiHash,
        user_id: user.id,
        expires_at: grant.expiresAt,
      });
    if (persisted.error) {
      console.error("[auth/recovery] grant persistence failed", persisted.error.code);
      return resetFailure(supabase, request, url, "unavailable");
    }

    const response = NextResponse.redirect(
      new URL("/auth/reset/confirm", url.origin),
    );
    response.cookies.set(RECOVERY_GRANT_COOKIE, grant.token, {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/auth/reset/confirm",
      maxAge: 15 * 60,
    });
    return response;
  } catch (error) {
    console.error(
      "[auth/recovery] callback transport failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return resetFailure(supabase, request, url, "unavailable");
  }
}

async function resetFailure(
  supabase: ServerSupabase | null,
  request: NextRequest,
  url: URL,
  reason: "expired" | "unavailable",
): Promise<NextResponse> {
  if (supabase) {
    try {
      const signedOut = await supabase.auth.signOut();
      if (signedOut.error) {
        console.error(
          "[auth/recovery] remote session cleanup failed",
          signedOut.error.message,
        );
      }
    } catch (signOutError) {
      console.error(
        "[auth/recovery] failure session cleanup threw",
        signOutError instanceof Error ? signOutError.message : "unknown error",
      );
    }
  }
  const destination = new URL("/auth/reset", url.origin);
  destination.searchParams.set("error", reason);
  const response = NextResponse.redirect(destination);
  for (const cookie of request.cookies.getAll()) {
    if (/^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name)) {
      response.cookies.set(cookie.name, "", {
        httpOnly: true,
        secure: url.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
  }
  response.cookies.set(RECOVERY_GRANT_COOKIE, "", {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/auth/reset/confirm",
    maxAge: 0,
  });
  return response;
}
