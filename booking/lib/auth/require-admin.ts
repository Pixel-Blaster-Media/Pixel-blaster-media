import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isMissingSessionError } from "@/lib/auth/session-error";
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
  role: "admin" | "realtor";
}

interface AdminMembershipRow {
  organization_id: string;
  role: "owner" | "admin";
}

/**
 * Verifies the Supabase Auth user before resolving tenant membership.
 * Auth verification failure is fail-closed; authorization never relies on
 * locally decoded cookie claims.
 */
export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await getServerSupabase();
  const signInPath = await adminSignInPath();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    if (isMissingSessionError(userError)) redirect(signInPath);
    console.error("[auth] admin verification failed", userError.name);
    redirect("/auth/access-unavailable");
  }
  if (!user) redirect(signInPath);

  const userId = user.id;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, organization_id, email, full_name, archived_at, role")
    .eq("id", userId)
    .maybeSingle<ProfileLookupRow>();

  if (error) {
    console.error("[auth] profile lookup failed", error.code);
    redirect("/auth/access-unavailable");
  }
  if (!profile || profile.archived_at) {
    console.warn("[auth] no active profile for authed user", userId);
    redirect("/auth/no-workspace");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("profile_id", userId)
    .eq("organization_id", profile.organization_id)
    .in("role", ["owner", "admin"])
    .maybeSingle<AdminMembershipRow>();

  if (membershipError) {
    console.error("[auth] admin membership lookup failed", membershipError.code);
    redirect("/auth/access-unavailable");
  }
  if (!membership) {
    redirect(profile.role === "realtor" ? "/portal" : "/auth/no-workspace");
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
  return `/auth/sign-in?audience=company&next=${encodeURIComponent(next)}`;
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
