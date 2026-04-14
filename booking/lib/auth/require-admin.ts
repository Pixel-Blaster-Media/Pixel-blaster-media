import "server-only";

import { redirect } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

export interface AdminContext {
  userId: string;
  email: string;
  fullName: string | null;
}

interface ProfileLookupRow {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
}

/**
 * Server-component / server-action helper that:
 *   1. Verifies the request has a Supabase session (middleware already
 *      redirects unauthed visitors at /admin/* — this is belt-and-braces).
 *   2. Loads the corresponding profile row.
 *   3. Bounces non-admin users back to /portal so realtors who somehow
 *      land on /admin don't get a confusing access-denied page.
 *
 * Throws (via redirect) on auth failure; on success returns a small
 * context object so admin pages can render the user's name.
 */
export async function requireAdmin(): Promise<AdminContext> {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/admin");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .single<ProfileLookupRow>();

  if (error || !profile) {
    console.warn("[auth] no profile for authed user", user.id, error?.message);
    redirect("/auth/sign-in");
  }

  if (profile.role !== "admin") {
    redirect("/portal");
  }

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
  };
}
