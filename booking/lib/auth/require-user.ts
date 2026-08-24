import "server-only";

import { redirect } from "next/navigation";

import { isMissingSessionError } from "@/lib/auth/session-error";
import { getServerSupabase } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

export interface UserContext {
  userId: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  archived_at: string | null;
  role: UserRole;
}

interface ProfileRow {
  id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  archived_at: string | null;
  role: UserRole;
}

/**
 * Verifies the Supabase Auth user and returns the active profile context.
 * Does not enforce a role; use `requireAdmin()` for company access.
 */
export async function requireUser(nextPath?: string): Promise<UserContext> {
  const supabase = await getServerSupabase();
  const suffix = nextPath ? `&next=${encodeURIComponent(nextPath)}` : "";
  const signInPath = `/auth/sign-in?audience=realtor${suffix}`;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    if (isMissingSessionError(userError)) redirect(signInPath);
    console.error("[auth] user verification failed", userError.name);
    redirect("/auth/access-unavailable");
  }
  if (!user) redirect(signInPath);
  const userId = user.id;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, organization_id, email, full_name, phone, archived_at, role")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  if (error) {
    console.error("[auth] profile lookup failed", error.code);
    redirect("/auth/access-unavailable");
  }
  if (!profile) {
    console.warn("[auth] no profile for authed user", userId);
    redirect("/auth/no-workspace");
  }
  if (profile.archived_at) {
    console.warn("[auth] archived user tried to access the application", userId);
    redirect("/auth/no-workspace");
  }

  return {
    userId: profile.id,
    organizationId: profile.organization_id,
    email: profile.email,
    fullName: profile.full_name,
    phone: profile.phone,
    archived_at: profile.archived_at,
    role: profile.role,
  };
}
