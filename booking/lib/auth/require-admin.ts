import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";

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
  archived_at: string | null;
}

interface AdminMembershipRow {
  organization_id: string;
  role: "owner" | "admin";
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
  const signInPath = await adminSignInPath();

  // getSession() reads the stored cookie locally. It still *may* call
  // the network if the token is about to expire (auto-refresh) — but
  // for a fresh session the call returns immediately.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect(signInPath);
  }

  const userId = decodeUserIdFromJwt(session.access_token);
  if (!userId) {
    redirect(signInPath);
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, organization_id, email, full_name, archived_at")
    .eq("id", userId)
    .single<ProfileLookupRow>();

  if (error || !profile || profile.archived_at) {
    console.warn("[auth] no active profile for authed user", userId, error?.message);
    redirect(signInPath);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("profile_id", userId)
    .eq("organization_id", profile.organization_id)
    .in("role", ["owner", "admin"])
    .maybeSingle<AdminMembershipRow>();

  if (membershipError || !membership) {
    redirect("/portal");
  }

  return {
    userId: profile.id,
    organizationId: membership.organization_id,
    email: profile.email,
    fullName: profile.full_name,
  };
}

async function adminSignInPath(): Promise<string> {
  const headerStore = await headers();
  const currentPath = headerStore.get("x-current-path") ?? "/admin";
  const next = safeNextPath(currentPath);
  return `/auth/sign-in?next=${encodeURIComponent(next)}`;
}

function safeNextPath(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/admin";
  }
  if (next.startsWith("/auth/") || next.startsWith("/start/oauth/")) {
    return "/admin";
  }
  return next;
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
