import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const FLOW_TTL_SECONDS = 60 * 60;
const GRANT_TTL_SECONDS = 15 * 60;

interface RecoveryFlowPayload {
  email: string;
  exp: number;
  nonce: string;
}

interface RecoveryGrantPayload {
  userId: string;
  exp: number;
  jti: string;
}

export interface RecoveryGrant {
  token: string;
  jtiHash: string;
  expiresAt: string;
}

export const RECOVERY_GRANT_COOKIE = "pb_recovery_grant";

export function createRecoveryFlowToken(email: string): string {
  return signPayload<RecoveryFlowPayload>({
    email: email.trim().toLowerCase(),
    exp: nowSeconds() + FLOW_TTL_SECONDS,
    nonce: randomBytes(16).toString("base64url"),
  });
}

export function verifyRecoveryFlowToken(token: string | null): RecoveryFlowPayload | null {
  const payload = verifyPayload<RecoveryFlowPayload>(token);
  if (!payload || typeof payload.email !== "string" || typeof payload.nonce !== "string") {
    return null;
  }
  return payload;
}

export function createRecoveryGrant(userId: string): RecoveryGrant {
  const jti = randomBytes(32).toString("base64url");
  const exp = nowSeconds() + GRANT_TTL_SECONDS;
  return {
    token: signPayload<RecoveryGrantPayload>({
      userId,
      exp,
      jti,
    }),
    jtiHash: hashJti(jti),
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyRecoveryGrant(
  token: string | undefined,
  userId: string,
): { jtiHash: string } | null {
  const payload = verifyPayload<RecoveryGrantPayload>(token ?? null);
  if (
    payload?.userId !== userId ||
    typeof payload.jti !== "string" ||
    payload.jti.length < 32
  ) {
    return null;
  }
  return { jtiHash: hashJti(payload.jti) };
}

function hashJti(jti: string): string {
  return createHash("sha256").update(jti).digest("hex");
}

function signPayload<T extends { exp: number }>(payload: T): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

function verifyPayload<T extends { exp: number }>(token: string | null): T | null {
  if (!token) return null;
  const [encoded, supplied] = token.split(".");
  if (!encoded || !supplied) return null;
  const expected = signature(encoded);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as T;
    if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds()) return null;
    return payload;
  } catch {
    return null;
  }
}

function signature(value: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Recovery signing is not configured");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
