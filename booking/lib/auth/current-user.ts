import "server-only";

import { cache } from "react";

import { getServerSupabase } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

export interface CurrentUserContext {
  userId: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  role: UserRole;
}

interface ProfileRow {
  id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
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
      data: { session },
    } = await supabase.auth.getSession();

    const userId = session?.access_token
      ? decodeUserIdFromJwt(session.access_token)
      : null;

    if (!userId) return null;

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, organization_id, email, full_name, role, archived_at")
      .eq("id", userId)
      .single<ProfileRow>();

    if (error || !profile) return null;
    if (profile.role === "realtor" && profile.archived_at) return null;

    return {
      userId: profile.id,
      organizationId: profile.organization_id,
      email: profile.email,
      fullName: profile.full_name,
      role: profile.role,
    };
  } catch {
    return null;
  }
});

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
