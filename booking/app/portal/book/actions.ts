"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/require-user";
import {
  BUSINESS_TZ,
  isSlotAvailable,
} from "@/lib/booking/availability";
import { getActiveCatalog } from "@/lib/booking/catalog";
import { sendEmail } from "@/lib/email/resend";
import { getGoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import { getServiceSupabase } from "@/lib/supabase/server";

interface InsertedRow {
  id: string;
}

export interface SelfBookResult {
  ok: boolean;
  error?: string;
}

/**
 * Self-service booking action invoked by the realtor calendar form.
 *
 * Defense in depth: we re-validate every slug against the live catalog,
 * re-check slot availability, and read the owner_id from the authenticated
 * session rather than anything the client sent. Auto-confirms the booking
 * (status = 'confirmed').
 */
export async function createSelfBooking(
  _prev: SelfBookResult | null,
  formData: FormData,
): Promise<SelfBookResult> {
  const user = await requireUser("/portal/book");

  const serviceSlugs = ((formData.getAll("services") as string[]) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const addOnSlugs = ((formData.getAll("add_ons") as string[]) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const slotStartRaw = ((formData.get("slot") as string | null) ?? "").trim();
  const streetAddress =
    ((formData.get("street_address") as string | null) ?? "").trim();
  const city = ((formData.get("city") as string | null) ?? "").trim();
  const postalCode = ((formData.get("postal_code") as string | null) ?? "").trim();
  const notes = ((formData.get("notes") as string | null) ?? "").trim();

  if (serviceSlugs.length === 0) {
    return { ok: false, error: "Pick at least one service." };
  }
  if (!streetAddress) {
    return { ok: false, error: "Property address is required." };
  }
  if (!slotStartRaw) {
    return { ok: false, error: "Pick a time slot first." };
  }

  // Re-validate slugs against the live catalog — don't trust the client.
  const catalog = await getActiveCatalog();
  const bySlug = new Map<string, (typeof catalog.bundles)[number]>();
  for (const r of catalog.bundles) bySlug.set(r.slug, r);
  for (const r of catalog.aLaCarte) bySlug.set(r.slug, r);
  for (const r of catalog.addons) bySlug.set(r.slug, r);

  const validServices: typeof catalog.bundles = [];
  for (const slug of serviceSlugs) {
    const item = bySlug.get(slug);
    if (!item || item.kind === "addon") {
      return {
        ok: false,
        error: `Unknown service "${slug}". Refresh the page and try again.`,
      };
    }
    validServices.push(item);
  }

  const hasVideo = validServices.some((s) => s.is_video);

  const validAddons: typeof catalog.bundles = [];
  for (const slug of addOnSlugs) {
    const item = bySlug.get(slug);
    if (!item || item.kind !== "addon") continue;
    if (item.require_has_video && !hasVideo) continue;
    validAddons.push(item);
  }

  const slotStart = new Date(slotStartRaw);
  if (Number.isNaN(slotStart.getTime())) {
    return { ok: false, error: "That time doesn't look valid — try picking again." };
  }

  const duration = Math.max(
    validServices.reduce((n, s) => n + s.duration_minutes, 0) +
      validAddons.reduce((n, a) => n + a.duration_minutes, 0),
    60,
  );

  const stillFree = await isSlotAvailable(slotStart, duration);
  if (!stillFree) {
    return {
      ok: false,
      error:
        "That slot was just taken. Please pick another — the calendar has been refreshed.",
    };
  }

  const supabase = getServiceSupabase();

  const { data: existing } = await supabase
    .from("properties")
    .select("id")
    .eq("owner_id", user.userId)
    .eq("street_address", streetAddress)
    .limit(1)
    .maybeSingle<InsertedRow>();

  let propertyId: string | null = existing?.id ?? null;
  if (!propertyId) {
    const { data: created, error: propErr } = await supabase
      .from("properties")
      .insert({
        owner_id: user.userId,
        street_address: streetAddress,
        city: city || null,
        postal_code: postalCode || null,
      })
      .select("id")
      .single<InsertedRow>();
    if (propErr || !created) {
      console.error("[selfBook] property insert failed", propErr);
      return { ok: false, error: "Could not save property. Try again." };
    }
    propertyId = created.id;
  }

  // Store slugs in the legacy services[] / add_ons[] arrays so existing
  // code paths (email templates, admin views) keep working. A follow-up
  // commit will materialize booking_line_items for accurate invoicing.
  const legacyServices = validServices.map((s) => s.slug);
  const legacyAddons = validAddons.map((a) => a.slug);

  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert({
      property_id: propertyId,
      owner_id: user.userId,
      status: "confirmed",
      scheduled_at: slotStart.toISOString(),
      scheduled_ends_at: new Date(
        slotStart.getTime() + duration * 60_000,
      ).toISOString(),
      services: legacyServices,
      add_ons: legacyAddons,
      client_notes: notes || null,
    })
    .select("id")
    .single<InsertedRow>();

  if (bookErr || !booking) {
    console.error("[selfBook] booking insert failed", bookErr);
    if (bookErr?.code === "23P01") {
      return {
        ok: false,
        error:
          "That slot was just taken. Please pick another — the calendar has been refreshed.",
      };
    }
    return { ok: false, error: "Could not save booking. Try again." };
  }

  // Push the event to Google Calendar (best-effort — a failure here doesn't
  // block the booking since everything's already persisted). If successful,
  // we stash the event id on the booking so we can later update/cancel it.
  try {
    const gcal = await getGoogleCalendarClient();
    if (gcal) {
      const endAt = new Date(slotStart.getTime() + duration * 60_000);
      const serviceLabels = validServices.map((s) => s.name).join(", ");
      const addonLabels = validAddons.map((a) => a.name).join(", ");
      const realtor = user.fullName ?? user.email;
      const addressLine = [streetAddress, city, postalCode]
        .filter(Boolean)
        .join(", ");
      const event = await gcal.createEvent({
        summary: `Shoot — ${streetAddress}`,
        location: addressLine,
        description:
          `Realtor: ${realtor}\nEmail: ${user.email}\n` +
          `Services: ${serviceLabels}\n` +
          (addonLabels ? `Add-ons: ${addonLabels}\n` : "") +
          (notes ? `\nNotes:\n${notes}\n` : ""),
        startISO: slotStart.toISOString(),
        endISO: endAt.toISOString(),
        attendeeEmail: user.email,
        attendeeName: user.fullName ?? undefined,
      });
      await supabase
        .from("bookings")
        .update({
          google_calendar_event_id: event.id,
          google_calendar_event_url: event.htmlLink,
        })
        .eq("id", booking.id);
    }
  } catch (err) {
    console.warn("[selfBook] google calendar event create failed", err);
  }

  const adminTo = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (adminTo) {
    const when = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TZ,
      dateStyle: "full",
      timeStyle: "short",
    }).format(slotStart);
    const serviceLabels = validServices.map((s) => s.name).join(", ");
    const addonLabels = validAddons.map((a) => a.name).join(", ");
    await sendEmail({
      to: adminTo,
      subject: `New self-booking — ${streetAddress}`,
      html: `
        <p><strong>${user.fullName ?? user.email}</strong> just booked a shoot.</p>
        <p>
          <strong>Address:</strong> ${escapeHtml(streetAddress)}<br>
          <strong>When:</strong> ${escapeHtml(when)}<br>
          <strong>Services:</strong> ${escapeHtml(serviceLabels)}<br>
          ${addonLabels ? `<strong>Add-ons:</strong> ${escapeHtml(addonLabels)}<br>` : ""}
          ${notes ? `<strong>Notes:</strong> ${escapeHtml(notes)}<br>` : ""}
        </p>
        <p>Open in admin: ${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/bookings/${booking.id}</p>
      `,
      replyTo: user.email,
    });
  }

  redirect(`/portal/${propertyId}?booked=1`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
