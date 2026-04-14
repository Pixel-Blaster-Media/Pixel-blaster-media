"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServiceSupabase } from "@/lib/supabase/server";
import {
  type BookingActionResult,
  type BookingRequestInput,
  validateBookingRequest,
} from "@/lib/booking/schema";
import { sendEmail } from "@/lib/email/resend";
import {
  adminNotificationEmail,
  clientConfirmationEmail,
} from "@/lib/email/templates";

/**
 * Server Action invoked by the booking form on /book.
 *
 * Flow:
 *   1. Pull values out of FormData.
 *   2. Honeypot check — bots that fill `_company` get silently dropped.
 *   3. Validate. Errors are returned for the form to render inline.
 *   4. Insert into `booking_requests` via the service-role client.
 *   5. Fire-and-forget two emails (one to the realtor, one to admin).
 *   6. Redirect to /book/success.
 *
 * No payment is taken in v1.
 */
export async function submitBookingRequest(
  _prev: BookingActionResult | null,
  formData: FormData,
): Promise<BookingActionResult> {
  // 1. Honeypot — bots love to fill every input.
  if ((formData.get("_company") as string)?.trim()) {
    // Pretend success; don't tip off the bot.
    redirect("/book/success");
  }

  const input: BookingRequestInput = {
    contact_name: str(formData, "contact_name"),
    contact_email: str(formData, "contact_email").toLowerCase(),
    contact_phone: optStr(formData, "contact_phone"),
    brokerage: optStr(formData, "brokerage"),
    street_address: str(formData, "street_address"),
    city: optStr(formData, "city"),
    postal_code: optStr(formData, "postal_code"),
    square_footage: optInt(formData, "square_footage"),
    services: formData.getAll("services").map(String),
    add_ons: formData.getAll("add_ons").map(String),
    preferred_date: optStr(formData, "preferred_date"),
    preferred_time: optStr(formData, "preferred_time") as
      | BookingRequestInput["preferred_time"]
      | undefined,
    notes: optStr(formData, "notes"),
  };

  // 2. Validate.
  const errors = validateBookingRequest(input);
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // 3. Persist.
  const supabase = getServiceSupabase();
  const userAgent = headers().get("user-agent") ?? null;

  const { data, error } = await supabase
    .from("booking_requests")
    .insert({
      contact_name: input.contact_name,
      contact_email: input.contact_email,
      contact_phone: input.contact_phone ?? null,
      brokerage: input.brokerage ?? null,
      street_address: input.street_address,
      city: input.city ?? null,
      postal_code: input.postal_code ?? null,
      square_footage: input.square_footage ?? null,
      services: input.services,
      add_ons: input.add_ons,
      preferred_date: input.preferred_date ?? null,
      preferred_time: input.preferred_time ?? null,
      notes: input.notes ?? null,
      source: "web",
      user_agent: userAgent,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[booking] insert failed", error);
    return {
      ok: false,
      errors: {
        _form:
          "Something went wrong saving your request. Please try again or email Info@PixelBlasterMedia.com.",
      },
    };
  }

  const requestId = data.id;

  // 4. Send emails. Don't block the redirect on email success — the
  //    booking is already recorded; email failures get logged.
  const adminTo = process.env.ADMIN_NOTIFICATION_EMAIL;
  const clientEmail = clientConfirmationEmail({ request: input, requestId });
  const adminEmail = adminNotificationEmail({ request: input, requestId });

  await Promise.all([
    sendEmail({
      to: input.contact_email,
      subject: clientEmail.subject,
      html: clientEmail.html,
      replyTo: adminTo,
    }),
    adminTo
      ? sendEmail({
          to: adminTo,
          subject: adminEmail.subject,
          html: adminEmail.html,
          replyTo: input.contact_email,
        })
      : Promise.resolve({ ok: true, skipped: true } as const),
  ]);

  // 5. Done.
  redirect("/book/success");
}

// ---- FormData helpers ----
function str(fd: FormData, key: string): string {
  return ((fd.get(key) as string | null) ?? "").trim();
}
function optStr(fd: FormData, key: string): string | undefined {
  const v = str(fd, key);
  return v.length ? v : undefined;
}
function optInt(fd: FormData, key: string): number | undefined {
  const v = str(fd, key);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
