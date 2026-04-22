"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { parseCart, type CartLinePayload } from "@/lib/booking/cart-types";
import { getActiveCatalog } from "@/lib/booking/catalog";
import type { Database } from "@/lib/supabase/database.types";
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
import { getServiceSupabase } from "@/lib/supabase/server";

export async function submitBookingRequest(
  _prev: BookingActionResult | null,
  formData: FormData,
): Promise<BookingActionResult> {
  // Honeypot — bots love to fill every input.
  if ((formData.get("_company") as string)?.trim()) {
    redirect("/book/success");
  }

  // Cart — serialized JSON from CartPicker's hidden input.
  const rawCart = (formData.get("cart") as string | null) ?? "[]";
  let parsedCart: CartLinePayload[] = [];
  try {
    parsedCart = parseCart(JSON.parse(rawCart));
  } catch {
    parsedCart = [];
  }

  // Load the catalog server-side so we can trust slugs + IDs and reject
  // anything the client may have fabricated. Unknown ids are dropped.
  const catalog = await getActiveCatalog();
  const byId = new Map<string, (typeof catalog.bundles)[number]>();
  for (const r of catalog.bundles) byId.set(r.id, r);
  for (const r of catalog.aLaCarte) byId.set(r.id, r);
  for (const r of catalog.addons) byId.set(r.id, r);

  const cart: CartLinePayload[] = [];
  const legacyServices: string[] = [];
  const legacyAddOns: string[] = [];
  let hasVideo = false;
  for (const line of parsedCart) {
    const item = byId.get(line.catalog_item_id);
    if (!item) continue;
    const quantity =
      item.kind === "a_la_carte" ? Math.max(1, Math.floor(line.quantity)) : 1;
    cart.push({
      catalog_item_id: item.id,
      slug: item.slug,
      quantity,
    });
    // Mirror into legacy columns: services[] holds bundle + a-la-carte slugs
    // (repeated by qty); add_ons[] holds addon slugs.
    if (item.kind === "addon") {
      legacyAddOns.push(item.slug);
    } else {
      for (let i = 0; i < quantity; i++) legacyServices.push(item.slug);
      if (item.is_video) hasVideo = true;
    }
  }

  // Strip any "require_has_video" addons that no longer qualify after
  // filtering (defensive; the client UI auto-cleans, but don't trust it).
  const filteredCart = cart.filter((line) => {
    const item = byId.get(line.catalog_item_id);
    if (!item) return false;
    if (item.kind === "addon" && item.require_has_video && !hasVideo) {
      return false;
    }
    return true;
  });
  const filteredAddOns = filteredCart
    .map((l) => byId.get(l.catalog_item_id))
    .filter((it): it is NonNullable<typeof it> => !!it && it.kind === "addon")
    .map((it) => it.slug);

  const input: BookingRequestInput = {
    contact_name: str(formData, "contact_name"),
    contact_email: str(formData, "contact_email").toLowerCase(),
    contact_phone: optStr(formData, "contact_phone"),
    brokerage: optStr(formData, "brokerage"),
    street_address: str(formData, "street_address"),
    city: optStr(formData, "city"),
    postal_code: optStr(formData, "postal_code"),
    square_footage: optInt(formData, "square_footage"),
    cart: filteredCart,
    preferred_date: optStr(formData, "preferred_date"),
    preferred_time: optStr(formData, "preferred_time") as
      | BookingRequestInput["preferred_time"]
      | undefined,
    notes: optStr(formData, "notes"),
  };

  const errors = validateBookingRequest(input);
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

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
      services: legacyServices,
      add_ons: filteredAddOns,
      cart: filteredCart as unknown as Database["public"]["Tables"]["booking_requests"]["Insert"]["cart"],
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

  const adminTo = process.env.ADMIN_NOTIFICATION_EMAIL;
  const emailInput = {
    ...input,
    services: legacyServices,
    add_ons: filteredAddOns,
  };
  const clientEmail = clientConfirmationEmail({
    request: emailInput,
    requestId,
  });
  const adminEmail = adminNotificationEmail({
    request: emailInput,
    requestId,
  });

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
