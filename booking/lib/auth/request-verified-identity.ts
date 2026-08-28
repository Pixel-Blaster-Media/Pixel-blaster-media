import "server-only";

import { cookies } from "next/headers";

import {
  createRequestVerifiedIdentity,
  type VerificationResult,
} from "@/lib/auth/request-verified-identity-core";
import { supabaseSessionExpiryState } from "@/lib/auth/session-cookie-expiry";
import {
  getServerSupabase,
  getServerSupabaseRefreshFailureKind,
} from "@/lib/supabase/server";

export {
  createRequestVerifiedIdentity,
  resolveVerifiedIdentity,
  type RequestVerifiedIdentity,
  type VerifiedIdentityUser,
  type VerificationResult,
  type VerifyIdentity,
} from "@/lib/auth/request-verified-identity-core";

export const getRequestVerifiedIdentity = createRequestVerifiedIdentity(
  verifyCurrentRequestIdentity,
);

async function verifyCurrentRequestIdentity(): Promise<VerificationResult> {
  const cookieStore = await cookies();
  const localSessionState = supabaseSessionExpiryState(
    cookieStore.getAll(),
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  if (localSessionState === "unreadable") {
    return {
      data: { user: null },
      error: {
        name: "AuthInvalidSessionCookieError",
        message: "Authentication session cookie is invalid.",
        status: 400,
      },
    };
  }

  const supabase = await getServerSupabase();
  const result = await supabase.auth.getUser();
  if (
    result.error &&
    getServerSupabaseRefreshFailureKind(supabase) === "terminal"
  ) {
    // A consumed refresh token can be the losing half of a concurrent rotation.
    // Treat it as signed out without scheduling cookie cleanup that could erase
    // the winning response after it installs the rotated session.
    return {
      data: { user: null },
      error: {
        name: "AuthSessionMissingError",
        message: "Authentication session missing.",
      },
    };
  }
  return result;
}
