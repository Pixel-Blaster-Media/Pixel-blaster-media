import "server-only";

import { notFound } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";

import { requireAdmin, type AdminContext } from "./require-admin";

/**
 * Platform-owner gate. Platform access is granted only by the explicit,
 * server-side email allowlist and fails closed when it is not configured.
 */
export async function requirePlatformAdmin(): Promise<AdminContext> {
  const admin = await requireAdmin();
  if (!(await hasPlatformAdminAccess(admin))) notFound();
  return admin;
}

export async function hasPlatformAdminAccess(
  admin: AdminContext,
): Promise<boolean> {
  const explicitEmails = configuredPlatformAdminEmails();
  if (explicitEmails.length === 0) return false;

  const supabase = await getServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.email || user.id !== admin.userId) return false;
  return explicitEmails.includes(user.email.toLowerCase());
}

function configuredPlatformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
