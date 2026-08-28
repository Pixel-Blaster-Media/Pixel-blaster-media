import { cache } from "react";

import {
  isMissingSessionError,
  isUnavailableAuthError,
} from "./session-error.ts";

const AUTH_USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface VerifiedIdentityUser {
  id: string;
  email?: string;
}

interface VerificationError {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
}

export interface VerificationResult {
  data: { user: VerifiedIdentityUser | null };
  error: VerificationError | null;
}

export type RequestVerifiedIdentity =
  | { kind: "authenticated"; user: VerifiedIdentityUser }
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

export type VerifyIdentity = () => Promise<VerificationResult>;

export async function resolveVerifiedIdentity(
  verify: VerifyIdentity,
): Promise<RequestVerifiedIdentity> {
  let result: VerificationResult;
  try {
    result = await verify();
  } catch {
    return { kind: "unavailable" };
  }

  if (result.error) {
    if (isMissingSessionError(result.error)) return { kind: "missing" };
    return isUnavailableAuthError(result.error)
      ? { kind: "unavailable" }
      : { kind: "invalid" };
  }

  if (!result.data.user) return { kind: "missing" };
  const userId = result.data.user.id;
  if (
    typeof userId !== "string" ||
    userId.length === 0 ||
    userId.trim() !== userId ||
    !AUTH_USER_ID.test(userId)
  ) {
    return { kind: "invalid" };
  }
  return { kind: "authenticated", user: result.data.user };
}

export function createRequestVerifiedIdentity(verify: VerifyIdentity) {
  return cache(() => resolveVerifiedIdentity(verify));
}
