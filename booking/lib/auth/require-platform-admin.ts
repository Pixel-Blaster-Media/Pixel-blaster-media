import "server-only";

import { notFound } from "next/navigation";

import { hasVerifiedPlatformAdminAccess } from "@/lib/auth/platform-admin-access-core";

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
  if (explicitEmails.length === 0 || !admin.verifiedIdentity) return false;

  return hasVerifiedPlatformAdminAccess(
    admin.userId,
    { kind: "authenticated", user: admin.verifiedIdentity },
    explicitEmails,
  );
}

function configuredPlatformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
