import "server-only";

import { redirect } from "next/navigation";

import { getCurrentUserResult } from "@/lib/auth/current-user";
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

/**
 * Requires the request-scoped authoritative identity and active profile.
 * Does not enforce a role; use `requireAdmin()` for company access.
 */
export async function requireUser(nextPath?: string): Promise<UserContext> {
  const suffix = nextPath ? `&next=${encodeURIComponent(nextPath)}` : "";
  const signInPath = `/auth/sign-in?audience=realtor${suffix}`;
  const invalidSessionPath = `/auth/session-invalid?audience=realtor${suffix}`;
  const current = await getCurrentUserResult();

  if (current.kind === "missing") {
    redirect(signInPath);
  }
  if (current.kind === "invalid") {
    redirect(invalidSessionPath);
  }
  if (current.kind === "unavailable") {
    console.error("[auth] user verification unavailable");
    redirect("/auth/access-unavailable");
  }
  if (current.kind === "no_workspace") {
    console.warn("[auth] no profile for authenticated user");
    redirect("/auth/no-workspace");
  }

  const profile = current.profile;
  if (profile.archivedAt) {
    console.warn(
      "[auth] archived user tried to access the application",
      profile.userId,
    );
    redirect("/auth/no-workspace");
  }

  return {
    userId: profile.userId,
    organizationId: profile.organizationId,
    email: profile.email,
    fullName: profile.fullName,
    phone: profile.phone,
    archived_at: profile.archivedAt,
    role: profile.role,
  };
}
