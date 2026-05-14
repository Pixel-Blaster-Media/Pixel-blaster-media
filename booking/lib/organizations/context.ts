import "server-only";

import { requireAdmin } from "@/lib/auth/require-admin";
import { requireUser } from "@/lib/auth/require-user";

import { DEFAULT_ORGANIZATION_ID } from "./default";

export interface OrganizationScope {
  organizationId: string;
}

export function defaultOrganizationScope(): OrganizationScope {
  return { organizationId: DEFAULT_ORGANIZATION_ID };
}

export async function requireAdminOrganization(): Promise<OrganizationScope> {
  const admin = await requireAdmin();
  return { organizationId: admin.organizationId };
}

export async function requireUserOrganization(
  nextPath?: string,
): Promise<OrganizationScope> {
  const user = await requireUser(nextPath);
  return { organizationId: user.organizationId };
}
