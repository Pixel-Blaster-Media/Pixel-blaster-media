import "server-only";

import { redirect } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

export interface AdminContext {
  userId: string;
  organizationId: string;
  email: string;
  fullName: string | null;
}

interface ProfileLookupRow {
  id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
}

/**
 * Server-component / server-action helper that:
 *   1. Resolves the caller's user id from the session cookie. We read
 *      the stored access_token and decode the JWT payload ourselves
 *      rather than calling supabase.auth.getUser(), because
 *      getUser() makes an outbound fetch that can fail intermittently
 *      from Vercel serverless ("fetch failed") — a network blip there
 *      must not bounce a legitimately signed-in admin to /auth/sign-in.
 *   2. Loads the corresponding profile row via the Postgres REST
 *      endpoint (separate from the auth endpoint — those have
 *      different availability characteristics).
 *   3. Bounces non-admin users back to /portal so realtors who somehow
 *      land on /admin don't get a confusing access-denied page.
 *
 * Throws (via redirect) on auth failure; on success returns a small
 * context object so admin pages can render the user's name.
 */
export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await getServerSupabase();

  // getSession() reads the stored cookie locally. It still *may* call
  // the network if the token is about to expire (auto-refresh) — but
  // for a fresh session the call returns immediately.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect("/auth/sign-in?next=/admin");
  }

  const userId = decodeUserIdFromJwt(session.access_token);
  if (!userId) {
    redirect("/auth/sign-in?next=/admin");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, organization_id, email, full_name, role")
    .eq("id", userId)
    .single<ProfileLookupRow>();

  if (error || !profile) {
    console.warn("[auth] no profile for authed user", userId, error?.message);
    redirect("/auth/sign-in");
  }

  if (profile.role !== "admin") {
    redirect("/portal");
  }

  return {
    userId: profile.id,
    organizationId: profile.organization_id,
    email: profile.email,
    fullName: profile.full_name,
  };
}

/** Extract the `sub` (user id) claim from a Supabase access token JWT. */
function decodeUserIdFromJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { sub?: string; exp?: number };
    if (!payload.sub) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
