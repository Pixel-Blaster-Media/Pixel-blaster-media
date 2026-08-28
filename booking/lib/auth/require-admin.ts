import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getVerifiedAdminActionContext } from "@/lib/auth/admin-action-context";
import { getCurrentUserResult } from "@/lib/auth/current-user";
import type { VerifiedIdentityUser } from "@/lib/auth/request-verified-identity";
import { getServerSupabase } from "@/lib/supabase/server";

export interface AdminContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly verifiedIdentity?: Readonly<VerifiedIdentityUser>;
}

interface AdminMembershipRow {
  organization_id: string;
  role: "owner" | "admin";
}

/**
 * Verifies authoritative identity, active profile, and privileged membership.
 * React request caching keeps layout and page guards present while collapsing
 * their repeated verification and tenant-membership reads.
 */
export const requireAdmin = cache(async function requireAdmin(): Promise<AdminContext> {
  const inherited = getVerifiedAdminActionContext();
  if (inherited) return inherited;

  const current = await getCurrentUserResult();

  if (current.kind === "missing") {
    redirect(await adminAuthPath("/auth/sign-in"));
  }
  if (current.kind === "invalid") {
    redirect(await adminAuthPath("/auth/session-invalid"));
  }
  if (current.kind === "unavailable") {
    console.error("[auth] admin verification unavailable");
    redirect("/auth/access-unavailable");
  }
  if (current.kind === "no_workspace") {
    console.warn("[auth] no active profile for authenticated user");
    redirect("/auth/no-workspace");
  }

  const profile = current.profile;
  if (profile.archivedAt) {
    console.warn("[auth] archived user tried to access the admin workspace", profile.userId);
    redirect("/auth/no-workspace");
  }

  const supabase = await getServerSupabase();
  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("profile_id", profile.userId)
    .eq("organization_id", profile.organizationId)
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
    userId: profile.userId,
    organizationId: membership.organization_id,
    email: profile.email,
    fullName: profile.fullName,
    verifiedIdentity: current.verifiedIdentity,
  };
});

async function adminAuthPath(
  pathname: "/auth/sign-in" | "/auth/session-invalid",
): Promise<string> {
  const headerStore = await headers();
  const currentPath = headerStore.get("x-current-path") ?? "/admin";
  const next = safeNextPath(currentPath);
  return `${pathname}?audience=company&next=${encodeURIComponent(next)}`;
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
