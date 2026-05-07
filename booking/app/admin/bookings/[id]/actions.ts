"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { nextBookingStatuses } from "@/lib/booking/booking-status";
import { cancelBooking } from "@/lib/booking/cancel";
import { buildDeliveryLinks } from "@/lib/booking/delivery-links";
import { sendEmail } from "@/lib/email/resend";
import { deliveryReadyEmail } from "@/lib/email/templates";
import {
  createEnhance,
  createListing,
  createUpload,
  type FotelloShotType,
} from "@/lib/integrations/fotello/client";
import { syncEnhance } from "@/lib/integrations/fotello/sync";
import {
  parseIGuideAlias,
  parseIGuidePortalId,
} from "@/lib/integrations/iguide/parse-id";
import { getCredential } from "@/lib/integrations/credentials";
import { createIGuide as createIGuideInPortal } from "@/lib/integrations/iguide/portal-client";
import {
  recordIGuideCreateJob,
  syncIGuideForBooking,
} from "@/lib/integrations/iguide/sync";
import {
  createInvoiceForBooking,
  refreshInvoiceStatus as refreshInvoiceInQBO,
} from "@/lib/integrations/quickbooks/invoice";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type {
  BookingStatus,
  DeliverableType,
  Json,
  ListingWebsiteTemplate,
} from "@/lib/supabase/database.types";

interface BookingStatusRow {
  status: BookingStatus;
}

interface BookingMinimalRow {
  id: string;
  property_id: string;
}

interface BookingFotelloRow {
  id: string;
  property_id: string;
  fotello_listing_id: string | null;
  properties: {
    street_address: string;
    city: string | null;
  } | null;
}

interface BookingWithIGuideRow {
  id: string;
  property_id: string;
  iguide_id: string | null;
  iguide_portal_id: string | null;
}

interface ExistingIGuideBookingRow {
  id: string;
  scheduled_at: string | null;
  properties: {
    street_address: string;
    city: string | null;
  } | null;
}

interface BookingForIGuideCreateRow {
  id: string;
  property_id: string;
  unit_number: string | null;
  iguide_id: string | null;
  iguide_portal_id: string | null;
  properties: {
    street_address: string;
    city: string | null;
    province: string | null;
    postal_code: string | null;
  } | null;
}

interface BookingForInvoiceRow {
  id: string;
  services: string[];
  add_ons: string[];
  property_id: string;
  owner_id: string;
  properties: {
    street_address: string;
    city: string | null;
    postal_code: string | null;
  } | null;
  profiles: {
    email: string;
    full_name: string | null;
    phone: string | null;
    brokerage: string | null;
  } | null;
}

interface BookingForDeliveryEmailRow {
  id: string;
  property_id: string;
  properties: {
    street_address: string;
  } | null;
  profiles: {
    email: string;
    full_name: string | null;
  } | null;
}

interface ReadyDeliverableRow {
  id: string;
  type: DeliverableType;
  url: string;
  source: string;
  metadata: Json | null;
  ready_at: string | null;
}

interface BookingForListingWebsiteRow {
  id: string;
  property_id: string;
  owner_id: string;
  properties: {
    street_address: string;
    city: string | null;
  } | null;
  profiles: {
    email: string;
    full_name: string | null;
    phone: string | null;
    brokerage: string | null;
  } | null;
}

const VALID_DELIVERABLE_TYPES: DeliverableType[] = [
  "photo_gallery",
  "virtual_tour",
  "floor_plan",
  "video",
  "aerial",
];

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const LISTING_WEBSITE_TEMPLATES: ListingWebsiteTemplate[] = [
  "estate_cinematic",
  "clean_mls_plus",
  "modern_forest",
  "editorial_magazine",
];

const LISTING_WEBSITE_INCLUDED_SECTIONS = [
  "photos",
  "tour",
  "floor_plans",
  "video",
  "property_websites",
] as const;

/**
 * Move a booking forward in the status pipeline.
 *
 * The set of allowed transitions lives in `nextBookingStatuses` and is
 * re-validated server-side here so a manipulated client can't jump
 * straight from `confirmed` → `delivered`.
 */
export async function updateBookingStatus(
  bookingId: string,
  next: BookingStatus,
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await getServerSupabase();

  const { data: current, error: loadErr } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .single<BookingStatusRow>();

  if (loadErr || !current) return { ok: false, error: "Booking not found." };

  const allowed = nextBookingStatuses(current.status);
  if (!allowed.includes(next)) {
    return {
      ok: false,
      error: `Can't move from ${current.status} to ${next}.`,
    };
  }

  const service = getServiceSupabase();
  const { error } = await service
    .from("bookings")
    .update({ status: next })
    .eq("id", bookingId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}

/**
 * Admin-initiated cancel — includes side effects the pipeline button
 * doesn't (delete Google Calendar event, email the realtor). Use this
 * for user-facing "cancellations", and reserve `updateBookingStatus`
 * for normal pipeline progression.
 */
export async function cancelBookingAsAdmin(
  bookingId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const result = await cancelBooking(bookingId, "admin");
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}

/**
 * Manual deliverable entry — the Phase 3 fallback before the iGuide /
 * Fotello sync goes live in Phase 4/5. Source is always 'manual' here.
 *
 * Uses the service-role client so the deliverables RLS policy
 * (admin-write-only) is bypassed via privilege rather than relying on
 * the RLS check being satisfied, which keeps this insert path simple.
 */
export async function addManualDeliverable(
  bookingId: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const type = (formData.get("type") as string | null) ?? "";
  const url = ((formData.get("url") as string | null) ?? "").trim();
  const thumbnail =
    ((formData.get("thumbnail_url") as string | null) ?? "").trim() || null;
  const deliveryKind =
    ((formData.get("delivery_kind") as string | null) ?? "").trim() || null;
  const deliveryLabel =
    ((formData.get("delivery_label") as string | null) ?? "").trim() || null;

  if (!VALID_DELIVERABLE_TYPES.includes(type as DeliverableType)) {
    return { ok: false, error: "Pick a deliverable type." };
  }
  if (!url) {
    return { ok: false, error: "URL is required." };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return { ok: false, error: "URL must start with https://." };
    }
  } catch {
    return { ok: false, error: "URL doesn't look valid." };
  }

  const supabase = await getServerSupabase();
  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .select("id, property_id")
    .eq("id", bookingId)
    .single<BookingMinimalRow>();

  if (bookErr || !booking) return { ok: false, error: "Booking not found." };

  const service = getServiceSupabase();
  const { error } = await service.from("deliverables").insert({
    booking_id: booking.id,
    property_id: booking.property_id,
    type: type as DeliverableType,
    source: "manual",
    url,
    thumbnail_url: thumbnail,
    metadata: {
      ...(deliveryKind ? { delivery_kind: deliveryKind } : {}),
      ...(deliveryLabel ? { delivery_label: deliveryLabel } : {}),
    },
    ready_at: new Date().toISOString(),
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}

export async function deleteDeliverable(
  bookingId: string,
  deliverableId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const service = getServiceSupabase();
  const { error } = await service
    .from("deliverables")
    .delete()
    .eq("id", deliverableId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}

export async function saveListingWebsite(
  bookingId: string,
  formData: FormData,
): Promise<ActionResult & { slug?: string; publicUrl?: string }> {
  await requireAdmin();

  const service = getServiceSupabase();
  const { data: booking, error: bookingError } = await service
    .from("bookings")
    .select(
      "id, property_id, owner_id, properties(street_address, city), profiles(email, full_name, phone, brokerage)",
    )
    .eq("id", bookingId)
    .single<BookingForListingWebsiteRow>();

  if (bookingError || !booking) return { ok: false, error: "Booking not found." };
  if (!booking.properties) {
    return { ok: false, error: "Booking needs a property before a website can be saved." };
  }

  const template = ((formData.get("template") as string | null) ??
    "clean_mls_plus") as ListingWebsiteTemplate;
  if (!LISTING_WEBSITE_TEMPLATES.includes(template)) {
    return { ok: false, error: "Pick a valid website template." };
  }

  const existingSlug =
    ((formData.get("existing_slug") as string | null) ?? "").trim();
  const requestedSlug =
    ((formData.get("slug") as string | null) ?? "").trim();
  const slug = normalizeSlug(
    requestedSlug ||
      existingSlug ||
      [booking.properties.street_address, booking.properties.city]
        .filter(Boolean)
        .join(" "),
  );
  if (!slug) return { ok: false, error: "Website slug is required." };

  const headline = cleanOptional(formData.get("headline"));
  const description = cleanOptional(formData.get("description"));
  const heroImageUrl = cleanOptional(formData.get("hero_image_url"));
  const agentName = cleanOptional(formData.get("agent_name"));
  const agentEmail = cleanOptional(formData.get("agent_email"));
  const agentPhone = cleanOptional(formData.get("agent_phone"));
  const brokerageName = cleanOptional(formData.get("brokerage_name"));
  const ctaText = cleanOptional(formData.get("cta_text")) ?? "Contact agent";
  const ctaUrl = cleanOptional(formData.get("cta_url"));
  const isPublished = formData.get("is_published") === "on";
  const featureBullets = parseFeatureBullets(
    (formData.get("feature_bullets") as string | null) ?? "",
  );
  const includedSections = parseListingWebsiteSections(formData);

  for (const [label, value] of [
    ["Hero image URL", heroImageUrl],
    ["CTA URL", ctaUrl],
  ] as const) {
    if (value && !isSafePublicUrl(value)) {
      return { ok: false, error: `${label} must start with https://, mailto:, or tel:.` };
    }
  }

  const { data: slugOwner, error: slugError } = await service
    .from("listing_websites")
    .select("property_id")
    .eq("slug", slug)
    .maybeSingle<{ property_id: string }>();
  if (slugError) return { ok: false, error: slugError.message };
  if (slugOwner && slugOwner.property_id !== booking.property_id) {
    return { ok: false, error: "That public URL is already in use. Try a slightly different slug." };
  }

  const { error } = await service.from("listing_websites").upsert(
    {
      property_id: booking.property_id,
      booking_id: booking.id,
      owner_id: booking.owner_id,
      template,
      slug,
      is_published: isPublished,
      headline,
      description,
      feature_bullets: featureBullets,
      included_sections: includedSections,
      hero_image_url: heroImageUrl,
      agent_name: agentName ?? booking.profiles?.full_name ?? null,
      agent_email: agentEmail ?? booking.profiles?.email ?? null,
      agent_phone: agentPhone ?? booking.profiles?.phone ?? null,
      brokerage_name: brokerageName ?? booking.profiles?.brokerage ?? null,
      cta_text: ctaText,
      cta_url: ctaUrl,
    },
    { onConflict: "property_id" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/bookings/${bookingId}`);
  revalidatePath(`/listings/${slug}`);
  return {
    ok: true,
    slug,
    publicUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/listings/${slug}`,
  };
}

export async function sendDeliveryReadyEmail(
  bookingId: string,
  extraRecipientsInput = "",
): Promise<
  ActionResult & { resent?: boolean; sentAt?: string; recipientCount?: number }
> {
  const admin = await requireAdmin();
  const service = getServiceSupabase();

  const { data: booking, error: bookingError } = await service
    .from("bookings")
    .select("id, property_id, properties(street_address), profiles(email, full_name)")
    .eq("id", bookingId)
    .single<BookingForDeliveryEmailRow>();

  if (bookingError || !booking) {
    return { ok: false, error: "Booking not found." };
  }
  if (!booking.properties) {
    return { ok: false, error: "Booking has no property." };
  }
  if (!booking.profiles) {
    return { ok: false, error: "Booking has no realtor email." };
  }

  const { data: existing } = await service
    .from("booking_notifications")
    .select("id")
    .eq("booking_id", booking.id)
    .eq("kind", "delivery_ready")
    .eq("recipient_email", booking.profiles.email)
    .maybeSingle<{ id: string }>();

  const { data: deliverables } = await service
    .from("deliverables")
    .select("id, type, url, source, metadata, ready_at")
    .eq("booking_id", booking.id)
    .not("ready_at", "is", null)
    .returns<ReadyDeliverableRow[]>();

  const ready = (deliverables ?? []).filter(
    (deliverable) => deliverable.url && deliverable.url !== "about:blank",
  );
  if (ready.length === 0) {
    return {
      ok: false,
      error: "No ready deliverables yet. Add a video link or wait for Fotello/iGUIDE to finish.",
    };
  }

  const primaryRecipient = booking.profiles.email;
  const extraRecipients = parseRecipientEmails(extraRecipientsInput);
  const ccRecipients = uniqueEmails([
    admin.email,
    ...extraRecipients,
  ]).filter((email) => email.toLowerCase() !== primaryRecipient.toLowerCase());

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const portalLink = appUrl
    ? `${appUrl}/portal/${booking.property_id}`
    : `/portal/${booking.property_id}`;
  const email = deliveryReadyEmail({
    contactName: booking.profiles.full_name ?? booking.profiles.email,
    streetAddress: booking.properties.street_address,
    portalLink,
    deliverables: buildDeliveryLinks(ready, appUrl),
  });

  const sent = await sendEmail({
    to: primaryRecipient,
    ...(ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
    subject: email.subject,
    html: email.html,
  });
  if (!sent.ok) return { ok: false, error: sent.error ?? "Email failed." };

  const sentAt = new Date().toISOString();
  const notificationRows = [primaryRecipient, ...ccRecipients].map(
    (recipientEmail) => ({
      booking_id: booking.id,
      kind: "delivery_ready",
      recipient_email: recipientEmail,
      sent_at: sentAt,
    }),
  );
  const { error: notificationError } = await service
    .from("booking_notifications")
    .upsert(notificationRows, {
      onConflict: "booking_id,kind,recipient_email",
    });
  if (notificationError && notificationError.code !== "23505") {
    return { ok: false, error: notificationError.message };
  }

  revalidatePath(`/admin/bookings/${bookingId}`);
  return {
    ok: true,
    resent: Boolean(existing),
    sentAt,
    recipientCount: notificationRows.length,
  };
}

function parseRecipientEmails(input: string): string[] {
  return uniqueEmails(
    input
      .split(/[\s,;]+/)
      .map((email) => email.trim())
      .filter(Boolean)
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
  );
}

function uniqueEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const email of emails) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(email);
  }
  return unique;
}

function cleanOptional(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseFeatureBullets(input: string): string[] {
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const line of input.split(/\r?\n/)) {
    const cleaned = line.replace(/^[-*•]\s*/, "").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(cleaned);
    if (bullets.length >= 8) break;
  }
  return bullets;
}

function parseListingWebsiteSections(formData: FormData): string[] {
  const selected = formData
    .getAll("included_sections")
    .filter((value): value is string => typeof value === "string")
    .filter((value) =>
      (LISTING_WEBSITE_INCLUDED_SECTIONS as readonly string[]).includes(value),
    );
  return selected.length > 0
    ? selected
    : [...LISTING_WEBSITE_INCLUDED_SECTIONS];
}

function isSafePublicUrl(url: string): boolean {
  try {
    if (url.startsWith("mailto:") || url.startsWith("tel:")) return true;
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Save (or clear) an iGuide reference on a booking. Auto-detects whether
 * the pasted value is a Portal ID (`igXXXXX…` or a manage.youriguide.com
 * URL) or a public alias/URL, and routes to the right column:
 *
 *   - Portal ID → iguide_portal_id (immutable; enables Portal API sync)
 *   - Alias/URL → iguide_id (mutable slug; enables RESO fallback)
 *
 * Clearing the field wipes both columns so they can't drift.
 */
export async function saveIGuideId(
  bookingId: string,
  rawInput: string,
): Promise<
  ActionResult & {
    iguideId?: string | null;
    portalId?: string | null;
  }
> {
  await requireAdmin();

  const trimmed = rawInput.trim();

  if (trimmed === "") {
    const service = getServiceSupabase();
    const { error } = await service
      .from("bookings")
      .update({ iguide_id: null, iguide_portal_id: null })
      .eq("id", bookingId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/admin/bookings/${bookingId}`);
    return { ok: true, iguideId: null, portalId: null };
  }

  // Try portal id first — it's the higher-signal match ("igXXXXX" is
  // unambiguous, whereas a bare alphanumeric string could be either).
  const portalId = parseIGuidePortalId(trimmed);
  const alias = portalId ? null : parseIGuideAlias(trimmed);

  if (!portalId && !alias) {
    return {
      ok: false,
      error:
        "Couldn't parse that. Paste the tour's alias (e.g. 1044_rest_acres_rd_brant_on), a youriguide.com URL, or the Portal ID from manage.youriguide.com (e.g. igYGFV5GG6V8DD1).",
    };
  }

  const service = getServiceSupabase();
  const update: BookingUpdatePayload = {};
  if (portalId) {
    const { data: existing, error: existingError } = await service
      .from("bookings")
      .select("id, scheduled_at, properties(street_address, city)")
      .eq("iguide_portal_id", portalId)
      .neq("id", bookingId)
      .maybeSingle<ExistingIGuideBookingRow>();

    if (existingError) return { ok: false, error: existingError.message };
    if (existing) {
      const address = [
        existing.properties?.street_address,
        existing.properties?.city,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        ok: false,
        error: `That iGUIDE is already linked to another booking${
          address ? ` for ${address}` : ""
        }. Open /admin/bookings/${existing.id} and clear its iGUIDE link first if this tour belongs here instead.`,
      };
    }
    update.iguide_portal_id = portalId;
  }
  if (alias) {
    update.iguide_id = alias;
  }

  const { error } = await service
    .from("bookings")
    .update(update)
    .eq("id", bookingId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true, iguideId: alias, portalId };
}

type BookingUpdatePayload = {
  iguide_id?: string | null;
  iguide_portal_id?: string | null;
};

/**
 * Sync deliverables for the iGuide tour tagged on this booking. Uses
 * the authenticated Portal API when possible (requires the booking to
 * carry an `iguide_portal_id`, which the webhook sets automatically);
 * falls back to the public RESO autofill endpoint keyed by alias when
 * the portal id isn't known yet.
 */
export async function syncIGuide(
  bookingId: string,
): Promise<ActionResult & { upserts?: number; address?: string; portalId?: string }> {
  await requireAdmin();

  const supabase = await getServerSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, property_id, iguide_id, iguide_portal_id")
    .eq("id", bookingId)
    .single<BookingWithIGuideRow>();

  if (error || !booking) return { ok: false, error: "Booking not found." };
  if (!booking.iguide_id && !booking.iguide_portal_id) {
    return {
      ok: false,
      error: "No iGuide alias or portal ID on this booking — paste a URL above first.",
    };
  }

  const result = await syncIGuideForBooking(booking);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/bookings/${bookingId}`);
  return {
    ok: true,
    upserts: result.upserts,
    address: result.address,
    portalId: result.portalId,
  };
}

export async function createIGuideForBooking(
  bookingId: string,
): Promise<
  ActionResult & {
    iguideId?: string;
    portalId?: string;
    workOrderId?: string | null;
  }
> {
  await requireAdmin();

  const supabase = await getServerSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, property_id, unit_number, iguide_id, iguide_portal_id, properties(street_address, city, province, postal_code)",
    )
    .eq("id", bookingId)
    .single<BookingForIGuideCreateRow>();

  if (error || !booking) return { ok: false, error: "Booking not found." };
  if (!booking.properties) {
    return { ok: false, error: "Booking has no property address." };
  }
  if (booking.iguide_portal_id) {
    return {
      ok: false,
      error: "This booking already has an iGuide Portal ID.",
    };
  }

  const address = buildIGuideAddress(booking.properties.street_address);
  if (!address.streetNumber || !address.streetName) {
    return {
      ok: false,
      error: "Couldn't split the street address into a number and street name.",
    };
  }

  const webhookConfig = await buildIGuideWebhookConfig();
  if (!webhookConfig.ok) {
    return { ok: false, error: webhookConfig.error };
  }

  const result = await createIGuideInPortal({
    type: "standard",
    industry: "residential",
    address: {
      country: "CA",
      provinceState: booking.properties.province ?? "ON",
      city: booking.properties.city ?? "",
      postalCode: booking.properties.postal_code ?? "",
      streetNumber: address.streetNumber,
      streetName: address.streetName,
      ...(booking.unit_number ? { unit: booking.unit_number } : {}),
    },
    webhooks: webhookConfig.webhooks,
  });

  if (!result.ok || !result.data) {
    return {
      ok: false,
      error: result.error ?? "iGuide did not create the tour.",
    };
  }
  if (!result.data.id) {
    return { ok: false, error: "iGuide response did not include an id." };
  }

  const service = getServiceSupabase();
  const { error: updateErr } = await service
    .from("bookings")
    .update({
      iguide_portal_id: result.data.id,
      iguide_id: result.data.alias ?? booking.iguide_id,
    })
    .eq("id", bookingId);

  if (updateErr) return { ok: false, error: updateErr.message };

  const recorded = await recordIGuideCreateJob({
    bookingId: booking.id,
    propertyId: booking.property_id,
    iguideId: result.data.id,
    alias: result.data.alias ?? null,
    workOrderId: result.data.workOrderId ?? null,
    defaultViewId: result.data.defaultViewId ?? null,
    rawCreateResponse: result.data,
  });
  if (!recorded.ok) return { ok: false, error: recorded.error };

  revalidatePath(`/admin/bookings/${bookingId}`);
  return {
    ok: true,
    iguideId: result.data.alias,
    portalId: result.data.id,
    workOrderId: result.data.workOrderId ?? null,
  };
}

async function buildIGuideWebhookConfig(): Promise<
  | {
      ok: true;
      webhooks: Array<{
        event: "*";
        url: string;
      }>;
    }
  | { ok: false; error: string }
> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  const secret = await getCredential(
    "iguide",
    "webhook_secret",
    "IGUIDE_WEBHOOK_SECRET",
  );

  if (!appUrl) {
    return {
      ok: false,
      error:
        "NEXT_PUBLIC_APP_URL is required before creating iGUIDEs from the app so iGUIDE knows where to send webhooks.",
    };
  }
  if (!secret) {
    return {
      ok: false,
      error:
        "iGUIDE webhook secret is missing. Add it in Integrations or set IGUIDE_WEBHOOK_SECRET before creating iGUIDEs from the app.",
    };
  }

  const webhookUrl = new URL("/api/integrations/iguide/webhook", appUrl);
  webhookUrl.searchParams.set("secret", normalizeWebhookSecret(secret));

  return {
    ok: true,
    webhooks: [
      {
        event: "*",
        url: webhookUrl.toString(),
      },
    ],
  };
}

function normalizeWebhookSecret(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("secret")?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

function buildIGuideAddress(streetAddress: string): {
  streetNumber: string;
  streetName: string;
} {
  const trimmed = streetAddress.trim().replace(/\s+/g, " ");
  const match = trimmed.match(/^([0-9]+[A-Za-z-]?)\s+(.+)$/);
  if (!match) return { streetNumber: "", streetName: trimmed };
  return { streetNumber: match[1], streetName: match[2] };
}

// ---------------------------------------------------------------------------
// QuickBooks invoicing (Phase 7)
// ---------------------------------------------------------------------------

export async function createInvoice(
  bookingId: string,
): Promise<
  ActionResult & {
    invoiceUrl?: string;
    invoiceNumber?: string;
    totalCents?: number;
  }
> {
  await requireAdmin();

  const supabase = await getServerSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, services, add_ons, property_id, owner_id, properties(street_address, city, postal_code), profiles(email, full_name, phone, brokerage)",
    )
    .eq("id", bookingId)
    .single<BookingForInvoiceRow>();

  if (error || !booking) return { ok: false, error: "Booking not found." };
  if (!booking.profiles) {
    return { ok: false, error: "Booking has no realtor — can't invoice." };
  }
  if (!booking.properties) {
    return { ok: false, error: "Booking has no property — can't invoice." };
  }

  const result = await createInvoiceForBooking({
    bookingId: booking.id,
    services: booking.services,
    addOns: booking.add_ons,
    realtor: booking.profiles,
    property: booking.properties,
  });

  revalidatePath(`/admin/bookings/${bookingId}`);
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    invoiceUrl: result.invoiceUrl,
    invoiceNumber: result.invoiceNumber,
    totalCents: result.totalCents,
  };
}

export async function refreshInvoice(
  bookingId: string,
): Promise<ActionResult & { status?: string }> {
  await requireAdmin();
  const result = await refreshInvoiceInQBO(bookingId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true, status: result.status };
}

// ---------------------------------------------------------------------------
// Fotello (Phase 5)
// ---------------------------------------------------------------------------

export async function saveFotelloListingId(
  bookingId: string,
  rawInput: string,
): Promise<ActionResult & { listingId?: string | null }> {
  await requireAdmin();
  const trimmed = extractFotelloListingId(rawInput);
  const listingId = trimmed === "" ? null : trimmed;
  // Fotello listing ids are Firebase-style strings; we don't enforce a
  // format beyond "not whitespace" — the API will reject bad ids when
  // we use them, and surfacing that error is fine.

  const service = getServiceSupabase();
  const { error } = await service
    .from("bookings")
    .update({ fotello_listing_id: listingId })
    .eq("id", bookingId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true, listingId };
}

const FOTELLO_DELIVERY_LINKS = [
  {
    field: "listing_share_url",
    kind: "listing_share",
    label: "Fotello listing share link",
    type: "photo_gallery",
  },
  {
    field: "branded_property_website_url",
    kind: "branded_property_website",
    label: "Fotello branded property website",
    type: "virtual_tour",
  },
  {
    field: "unbranded_property_website_url",
    kind: "unbranded_property_website",
    label: "Fotello unbranded property website",
    type: "virtual_tour",
  },
] as const;

export async function saveFotelloDeliveryLinks(
  bookingId: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const service = getServiceSupabase();
  const { data: booking, error } = await service
    .from("bookings")
    .select("id, property_id, fotello_listing_id")
    .eq("id", bookingId)
    .single<{
      id: string;
      property_id: string;
      fotello_listing_id: string | null;
    }>();

  if (error || !booking) return { ok: false, error: "Booking not found." };

  const rows = [];
  for (const link of FOTELLO_DELIVERY_LINKS) {
    const rawUrl = ((formData.get(link.field) as string | null) ?? "").trim();
    if (!rawUrl) continue;

    const urlError = validateHttpsUrl(rawUrl);
    if (urlError) return { ok: false, error: `${link.label}: ${urlError}` };

    rows.push({
      booking_id: booking.id,
      property_id: booking.property_id,
      type: link.type as DeliverableType,
      source: "fotello" as const,
      external_id: `${booking.id}:${link.kind}`,
      url: rawUrl,
      embed_html: null,
      thumbnail_url: null,
      metadata: {
        delivery_kind: link.kind,
        delivery_label: link.label,
        fotello_listing_id: booking.fotello_listing_id,
        last_synced_at: new Date().toISOString(),
      },
      ready_at: new Date().toISOString(),
    });
  }

  const externalIds = FOTELLO_DELIVERY_LINKS.map(
    (link) => `${booking.id}:${link.kind}`,
  );
  const { error: deleteError } = await service
    .from("deliverables")
    .delete()
    .eq("booking_id", booking.id)
    .eq("source", "fotello")
    .in("external_id", externalIds);
  if (deleteError) return { ok: false, error: deleteError.message };

  if (rows.length > 0) {
    const { error: insertError } = await service
      .from("deliverables")
      .insert(rows);
    if (insertError) return { ok: false, error: insertError.message };
  }

  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}

function validateHttpsUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" ? null : "URL must start with https://.";
  } catch {
    return "URL doesn't look valid.";
  }
}

function extractFotelloListingId(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const listingIndex = segments.findIndex((segment) => segment === "listings");
    if (listingIndex >= 0 && segments[listingIndex + 1]) {
      return segments[listingIndex + 1];
    }
  } catch {
    // Not a URL; treat it as the ID itself.
  }

  return trimmed;
}

export async function prepareFotelloUpload(
  bookingId: string,
  filenames: string[],
): Promise<
  ActionResult & {
    listingId?: string;
    uploads?: Array<{ id: string; url: string; expires: string }>;
  }
> {
  await requireAdmin();

  const cleanFilenames = filenames
    .map((filename) => filename.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (cleanFilenames.length === 0) {
    return { ok: false, error: "Pick at least one photo." };
  }

  const service = getServiceSupabase();
  const { data: booking, error } = await service
    .from("bookings")
    .select("id, property_id, fotello_listing_id, properties(street_address, city)")
    .eq("id", bookingId)
    .single<BookingFotelloRow>();

  if (error || !booking) return { ok: false, error: "Booking not found." };

  try {
    let listingId = booking.fotello_listing_id;
    if (!listingId) {
      const listing = await createListing(fotelloListingName(booking));
      listingId = listing.id;
      const { error: updateError } = await service
        .from("bookings")
        .update({ fotello_listing_id: listingId })
        .eq("id", booking.id);
      if (updateError) return { ok: false, error: updateError.message };
    }

    const uploads = await Promise.all(
      cleanFilenames.map((filename) => createUpload(filename)),
    );
    revalidatePath(`/admin/bookings/${bookingId}`);
    return {
      ok: true,
      listingId,
      uploads: uploads.map((upload) => ({
        id: upload.id,
        url: upload.url,
        expires: upload.expires,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Fotello could not prepare uploads.",
    };
  }
}

export async function startFotelloEnhance(
  bookingId: string,
  uploadIds: string[],
  listingId: string,
): Promise<ActionResult & { enhanceId?: string; status?: string }> {
  await requireAdmin();

  const cleanUploadIds = uploadIds.map((id) => id.trim()).filter(Boolean);
  const cleanListingId = listingId.trim();
  if (cleanUploadIds.length === 0) {
    return { ok: false, error: "No Fotello upload IDs were provided." };
  }
  if (!cleanListingId) {
    return { ok: false, error: "Missing Fotello listing ID." };
  }

  const service = getServiceSupabase();
  const { data: booking, error } = await service
    .from("bookings")
    .select("id, property_id, fotello_listing_id")
    .eq("id", bookingId)
    .single<{
      id: string;
      property_id: string;
      fotello_listing_id: string | null;
    }>();

  if (error || !booking) return { ok: false, error: "Booking not found." };
  if (booking.fotello_listing_id !== cleanListingId) {
    const { error: updateError } = await service
      .from("bookings")
      .update({ fotello_listing_id: cleanListingId })
      .eq("id", booking.id);
    if (updateError) return { ok: false, error: updateError.message };
  }

  try {
    const enhance = await createEnhance({
      uploadIds: cleanUploadIds,
      listingId: cleanListingId,
    });
    const result = await syncEnhance({
      enhanceId: enhance.id,
      booking: {
        id: booking.id,
        property_id: booking.property_id,
        fotello_listing_id: cleanListingId,
      },
    });

    revalidatePath(`/admin/bookings/${bookingId}`);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, enhanceId: enhance.id, status: result.status };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Fotello could not start enhance.",
    };
  }
}

/**
 * Track (or refresh) a Fotello enhance against the booking. If the
 * enhance is already `completed`, the sync run will upsert a
 * photo_gallery deliverable immediately. If it's in progress, we still
 * write a placeholder row so the admin can see it pending; the next
 * refresh will flip it to ready.
 */
export async function trackFotelloEnhance(
  bookingId: string,
  enhanceId: string,
  shotType: FotelloShotType,
): Promise<ActionResult & { status?: string }> {
  await requireAdmin();
  const trimmed = enhanceId.trim();
  if (!trimmed) return { ok: false, error: "Enhance ID is required." };

  const supabase = await getServerSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, property_id, fotello_listing_id")
    .eq("id", bookingId)
    .single<{
      id: string;
      property_id: string;
      fotello_listing_id: string | null;
    }>();

  if (error || !booking) return { ok: false, error: "Booking not found." };

  const result = await syncEnhance({
    enhanceId: trimmed,
    booking,
    shotType,
  });

  revalidatePath(`/admin/bookings/${bookingId}`);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, status: result.status };
}

function fotelloListingName(booking: BookingFotelloRow): string {
  const address = [
    booking.properties?.street_address,
    booking.properties?.city,
  ]
    .filter(Boolean)
    .join(", ");
  return address || `Booking ${booking.id}`;
}

/** Untrack (delete) a Fotello-sourced deliverable row. */
export async function untrackFotelloEnhance(
  bookingId: string,
  deliverableId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const service = getServiceSupabase();
  const { error } = await service
    .from("deliverables")
    .delete()
    .eq("id", deliverableId)
    .eq("source", "fotello");
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { ok: true };
}
