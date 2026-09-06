import "server-only";
import { createHash, randomInt } from "node:crypto";
import { sendEmail } from "@/lib/email/resend";
import { getServiceSupabase } from "@/lib/supabase/server";

export function publicBookingFingerprint(form: FormData): string {
  // The password stays in browser memory only; never persist it in the draft.
  const entries = [...form.entries()]
    .filter(([key]) => !key.startsWith("$ACTION_") && !["password", "verification_code"].includes(key))
    .map(([key, value]) => [key, String(value)]).sort();
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export async function requirePublicBookingInbox(params: {
  requestId: string; organizationId: string; email: string; fingerprint: string;
  code: string;
}): Promise<{ ok: boolean; verificationRequired?: boolean; errors?: Record<string, string> }> {

  const scope = {
    p_request_id: params.requestId, p_organization_id: params.organizationId,
    p_email: params.email, p_fingerprint: params.fingerprint,
  };
  try {
    // Bounded local signature for the additive migration; no browser RPC grant.
    const service = getServiceSupabase();
    const rpc = service.rpc.bind(service) as unknown as (
      name: "verify_public_booking_inbox" | "begin_public_booking_verification", args: Record<string, string>,
    ) => Promise<{ data: unknown; error: unknown }>;
    if (params.code) {
      const verified = await rpc("verify_public_booking_inbox", {
        ...scope, p_code_hash: hashCode(params.code),
      });
      if (!verified.error && verified.data === true) return { ok: true };
      return { ok: false, verificationRequired: true, errors: {
        verification_code: "That code is invalid or expired. Check your inbox or request a new code after 10 minutes.",
      } };
    }
    const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
    const begun = await rpc("begin_public_booking_verification", {
      ...scope, p_code_hash: hashCode(code),
    });
    if (begun.error) throw new Error("verification unavailable");
    if (begun.data === true) {
      const sent = await sendEmail({
        organizationId: params.organizationId, to: params.email,
        subject: "Verify your booking email",
        html: `<p>Your booking verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. Enter it only on the booking form you started. No booking has been made. If you did not request this, ignore this email.</p>`,
        text: `Your booking verification code is ${code}. It expires in 10 minutes. Enter it only on the booking form you started. No booking has been made. If you did not request this, ignore this email.`,
        idempotencyKey: `public-inbox-${params.requestId}-${hashCode(code)}`,
      });
      if (!sent.ok || sent.skipped || !sent.id) throw new Error("verification unavailable");
    }
    return { ok: false, verificationRequired: true };
  } catch {
    return { ok: false, verificationRequired: true, errors: {
      _form: "We couldn't send a verification code right now. Wait 10 minutes and try again. No booking has been made.",
    } };
  }
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
