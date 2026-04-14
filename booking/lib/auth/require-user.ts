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
 * Redirects to /auth/sign-in on missing session. Redirects to sign-in
 * again (this time unadorned) if the session exists but the profile row
 * is missing — that shouldn't happen in practice (trigger creates it),
 * but defending against it costs nothing.
 *
 * The `next` param preserves the originally-requested path so the user
 * lands where they intended after clicking the magic link.
 */
export async function requireUser(nextPath?: string): Promise<UserContext> {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const suffix = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/auth/sign-in${suffix}`);
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .single<ProfileRow>();

  if (error || !profile) {
    console.warn("[auth] no profile for authed user", user.id, error?.message);
    redirect("/auth/sign-in");
  }

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
  };
}
