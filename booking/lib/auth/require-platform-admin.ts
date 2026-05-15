import "server-only";

import { notFound } from "next/navigation";

import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";

import { requireAdmin, type AdminContext } from "./require-admin";

/**
 * Temporary platform-owner gate.
 *
 * Pixel Blaster is the first/default organization, so only its admins can
 * create other companies until we add a dedicated platform role.
 */
export async function requirePlatformAdmin(): Promise<AdminContext> {
  const admin = await requireAdmin();
  if (admin.organizationId !== DEFAULT_ORGANIZATION_ID) notFound();
  return admin;
}

export function isPlatformAdmin(admin: AdminContext): boolean {
  return admin.organizationId === DEFAULT_ORGANIZATION_ID;
}
