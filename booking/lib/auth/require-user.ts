import "server-only";

import { redirect } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

export interface UserContext {
  userId: string;
  email: string;
  fullName: string | null;
  role: UserRole;
}

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
}

/**
 * Server-component / server-action helper that ensures the request is
 * authenticated and returns a small profile context. Does NOT enforce a
 * role — use `requireAdmin()` for that.
 *
 * We resolve the user id from the session cookie (via getSession +
 * JWT decode) rather than calling supabase.auth.getUser() — see
 * require-admin.ts for the rationale. Summary: getUser() makes an
 * outbound fetch that can fail intermittently from Vercel serverless,
 * and a network blip must not log out a valid session.
 */
export async function requireUser(nextPath?: string): Promise<UserContext> {
  const supabase = await getServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.access_token
    ? decodeUserIdFromJwt(session.access_token)
    : null;

  if (!userId) {
    const suffix = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/auth/sign-in${suffix}`);
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", userId)
    .single<ProfileRow>();

  if (error || !profile) {
    console.warn("[auth] no profile for authed user", userId, error?.message);
    redirect("/auth/sign-in");
  }

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
  };
}

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
