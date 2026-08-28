import "server-only";

import { createAdminActionContextStore } from "@/lib/auth/admin-action-context-core";
import type { AdminContext } from "@/lib/auth/require-admin";

const verifiedAdminActionContext =
  createAdminActionContextStore<AdminContext>();

/** Return an Admin context only when an outer server boundary already verified it. */
export function getVerifiedAdminActionContext(): AdminContext | null {
  return verifiedAdminActionContext.get();
}

/**
 * Carry an already-verified Admin context through nested server-side action
 * helpers. This module is not a `use server` action surface and cannot be
 * invoked by a client with a forged context object.
 */
export function runWithVerifiedAdminActionContext<Result>(
  admin: AdminContext,
  operation: () => Promise<Result>,
): Promise<Result> {
  return verifiedAdminActionContext.run(admin, operation);
}
