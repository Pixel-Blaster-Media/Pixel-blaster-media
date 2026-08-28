import type { RequestVerifiedIdentity } from "@/lib/auth/request-verified-identity-core";

/** Pure, fail-closed platform access decision over authoritative identity data. */
export function hasVerifiedPlatformAdminAccess(
  adminUserId: string,
  identity: RequestVerifiedIdentity,
  explicitEmails: readonly string[],
): boolean {
  if (explicitEmails.length === 0 || identity.kind !== "authenticated") {
    return false;
  }
  if (
    identity.user.id !== adminUserId ||
    typeof identity.user.email !== "string" ||
    identity.user.email.length === 0
  ) {
    return false;
  }
  return explicitEmails.includes(identity.user.email.toLowerCase());
}
