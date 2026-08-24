import "server-only";

import { cache } from "react";

import { getServerSupabase } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

export interface CurrentUserContext {
  userId: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  profilePhotoUrl: string | null;
  role: UserRole;
}

interface ProfileRow {
  id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
  profile_photo_url: string | null;
  role: UserRole;
  archived_at: string | null;
}

/**
 * Per-request memoized: the root layout calls this on every page, and
 * authed pages look the profile up again — cache() collapses those into
 * one query per request.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<
  CurrentUserContext | null
> {
  try {
    const supabase = await getServerSupabase();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return null;
    const userId = user.id;

    const { data: profile, error } = await supabase
      .from("profiles")
      .select(
        "id, organization_id, email, full_name, profile_photo_url, role, archived_at",
      )
      .eq("id", userId)
      .single<ProfileRow>();

    if (error || !profile) return null;
    if (profile.role === "realtor" && profile.archived_at) return null;

    return {
      userId: profile.id,
      organizationId: profile.organization_id,
      email: profile.email,
      fullName: profile.full_name,
      profilePhotoUrl: profile.profile_photo_url,
      role: profile.role,
    };
  } catch {
    return null;
  }
});
