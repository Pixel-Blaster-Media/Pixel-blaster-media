import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed "manage booking" tokens for the public self-serve
 * reschedule/cancel page (/book/manage/[token]).
 *
 * Stateless by design — no DB column or migration. The token is
 * `${bookingId}.${hex hmac-sha256(bookingId)}`, so anyone holding the
 * confirmation email can manage that one booking and nothing else.
 *
 * The secret falls back to the Supabase service-role key so the feature
 * works without new env vars; set BOOKING_MANAGE_SECRET to rotate manage
 * links independently of the service key.
 */

function getManageSecret(): string {
  const secret =
    process.env.BOOKING_MANAGE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "BOOKING_MANAGE_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set to sign manage-booking links.",
    );
  }
  return secret;
}

function sign(bookingId: string): string {
  return createHmac("sha256", getManageSecret())
    .update(bookingId)
    .digest("hex");
}

export function createManageToken(bookingId: string): string {
  return `${bookingId}.${sign(bookingId)}`;
}

/**
 * Verify a manage token and return the booking id it was issued for,
 * or null if the signature doesn't check out.
 */
export function verifyManageToken(token: string): string | null {
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0) return null;

  const bookingId = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  // HMAC-SHA256 hex is always 64 lowercase hex chars — cheap pre-check
  // that also guarantees the timingSafeEqual buffers match in length.
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;

  let expected: string;
  try {
    expected = sign(bookingId);
  } catch {
    return null;
  }

  const provided = Buffer.from(signature, "hex");
  const computed = Buffer.from(expected, "hex");
  if (provided.length !== computed.length) return null;
  return timingSafeEqual(provided, computed) ? bookingId : null;
}
