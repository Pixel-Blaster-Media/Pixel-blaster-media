import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export interface BetaInviteLifecycle {
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

export function createBetaInviteToken(): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  return { rawToken, tokenHash: hashBetaInviteToken(rawToken) };
}

export function hashBetaInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function isBetaInviteUsable(
  invite: BetaInviteLifecycle,
  now = new Date(),
): boolean {
  const expiresAt = new Date(invite.expiresAt);
  return (
    Number.isFinite(expiresAt.getTime()) &&
    expiresAt.getTime() > now.getTime() &&
    invite.consumedAt === null &&
    invite.revokedAt === null
  );
}
