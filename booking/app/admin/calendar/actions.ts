"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  BUSINESS_TZ,
  businessDateTimeLocalToUtc,
  isSlotAvailable,
} from "@/lib/booking/availability";
import {
  computeCartTotals,
  getActiveCatalog,
  validateCart,
  type CatalogItemRow,
} from "@/lib/booking/catalog";
import { sendEmail } from "@/lib/email/resend";
import { getOrganizationEmailSettings } from "@/lib/email/settings";
import { getGoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
  bookingId?: string;
}

interface RealtorSearchResult {
  ok: boolean;
  error?: string;
  realtors: RealtorSearchItem[];
}

export interface RealtorSearchItem {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  brokerage: string;
}

interface ProfileSearchRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  brokerage: string | null;
}

interface InsertedRow {
  id: string;
}

export async function searchRealtors(
  query: string,
): Promise<RealtorSearchResult> {
  const admin = await requireAdmin();

  const term = query.trim();
  if (term.length < 2) {
    return { ok: true, realtors: [] };
  }

  const safeTerm = term.replace(/[%_]/g, "");
  const pattern = `%${safeTerm}%`;
  const supabase = await getServerSupabase();
  const [nameRes, emailRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, phone, brokerage")
      .eq("organization_id", admin.organizationId)
      .eq("role", "realtor")
      .ilike("full_name", pattern)
      .order("full_name", { ascending: true, nullsFirst: false })
      .limit(8)
      .returns<ProfileSearchRow[]>(),
    supabase
      .from("profiles")
      .select("id, email, full_name, phone, brokerage")
      .eq("organization_id", admin.organizationId)
      .eq("role", "realtor")
      .ilike("email", pattern)
      .order("email", { ascending: true })
      .limit(8)
      .returns<ProfileSearchRow[]>(),
  ]);

  const firstError = nameRes.error ?? emailRes.error;
  if (firstError) {
    console.warn("[admin-calendar] realtor search failed", firstError.message);
    return {
      ok: false,
      error: "Could not search realtors. Enter details manually.",
      realtors: [],
    };
  }

  const byId = new Map<string, RealtorSearchItem>();
  for (const row of [...(nameRes.data ?? []), ...(emailRes.data ?? [])]) {
    byId.set(row.id, {
      id: row.id,
      email: row.email,
      fullName: row.full_name ?? "",
      phone: row.phone ?? "",
      brokerage: row.brokerage ?? "",
    });
  }

  return {
    ok: true,
    realtors: Array.from(byId.values()).slice(0, 8),
  };
}

export async function createAdminShoot(
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const scheduledRaw = str(formData, "scheduled_at");
  const scheduledAt = businessDateTimeLocalToUtc(scheduledRaw);
  const contactEmail = str(formData, "contact_email").toLowerCase();
  const contactName = str(formData, "contact_name");
  const contactPhone = str(formData, "contact_phone");
  const brokerage = str(formData, "brokerage");
  const streetAddress = str(formData, "street_address");
  const unitNumber = str(formData, "unit_number");
  const city = str(formData, "city");
  const province = str(formData, "province") || "ON";
  const postalCode = str(formData, "postal_code");
  const notes = str(formData, "notes");
  const squareFootage = parseOptionalInt(str(formData, "square_footage"));
  const selectedCatalogIds = formData
    .getAll("catalog_item_id")
    .map((v) => String(v).trim())
    .filter(Boolean);

  if (!scheduledAt) return { ok: false, error: "Pick a valid start time." };
  if (!contactEmail || !contactEmail.includes("@")) {
    return { ok: false, error: "Enter the realtor's email." };
  }
  if (!contactName) return { ok: false, error: "Enter the realtor's name." };
  if (!streetAddress) return { ok: false, error: "Enter the property address." };

  const catalog = await getActiveCatalog({ organizationId: admin.organizationId });
  const byId = new Map<string, CatalogItemRow>();
  for (const item of catalog.bundles) byId.set(item.id, item);
  for (const item of catalog.aLaCarte) byId.set(item.id, item);
  for (const item of catalog.addons) byId.set(item.id, item);

  const cart = selectedCatalogIds
    .map((catalogItemId) => ({ catalogItemId, quantity: 1 }))
    .filter((line) => byId.has(line.catalogItemId));
  const cartError = validateCart(cart, catalog);
  if (cartError) return { ok: false, error: cartError };

  const totals = computeCartTotals(cart, catalog);
  const duration = Math.max(totals.totalDurationMinutes, 60);
  const stillFree = await isSlotAvailable(scheduledAt, duration, {
    organizationId: admin.organizationId,
  });
  if (!stillFree) {
    return {
      ok: false,
      error: "That time overlaps another booking or blocked time. Pick another slot.",
    };
  }

  const selectedItems = cart
    .map((line) => byId.get(line.catalogItemId))
    .filter((item): item is CatalogItemRow => Boolean(item));
  const legacyServices = selectedItems
    .filter((item) => item.kind !== "addon")
    .map((item) => item.slug);
  const legacyAddons = selectedItems
    .filter((item) => item.kind === "addon")
    .map((item) => item.slug);

  const supabase = getServiceSupabase();
  const userId = await findOrCreateRealtor({
    organizationId: admin.organizationId,
    email: contactEmail,
    fullName: contactName,
  });
  if (!userId) return { ok: false, error: "Could not create realtor account." };

  await supabase
    .from("profiles")
    .update({
      full_name: contactName,
      phone: contactPhone || null,
      brokerage: brokerage || null,
    })
    .eq("organization_id", admin.organizationId)
    .eq("id", userId);

  const propertyId = await findOrCreateProperty({
    organizationId: admin.organizationId,
    ownerId: userId,
    streetAddress,
    city,
    province,
    postalCode,
  });
  if (!propertyId) return { ok: false, error: "Could not save property." };

  const scheduledEndsAt = new Date(
    scheduledAt.getTime() + duration * 60_000,
  ).toISOString();
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      organization_id: admin.organizationId,
      property_id: propertyId,
      owner_id: userId,
      status: "confirmed",
      scheduled_at: scheduledAt.toISOString(),
      scheduled_ends_at: scheduledEndsAt,
      services: legacyServices,
      add_ons: legacyAddons,
      square_footage: squareFootage,
      unit_number: unitNumber || null,
      client_notes: notes || null,
    })
    .select("id")
    .single<InsertedRow>();

  if (bookingError || !booking) {
    console.error("[admin-calendar] booking insert failed", bookingError);
    if (bookingError?.code === "23P01") {
      return {
        ok: false,
        error: "That time overlaps another active booking. Pick another slot.",
      };
    }
    return { ok: false, error: "Could not save booking." };
  }

  const lineItems = selectedItems.map((item) => ({
    booking_id: booking.id,
    catalog_item_id: item.id,
    quantity: 1,
    unit_price_cents: item.price_cents,
    unit_duration_minutes: item.duration_minutes,
  }));
  const { error: lineItemError } = await supabase
    .from("booking_line_items")
    .insert(lineItems);
  if (lineItemError) {
    console.warn("[admin-calendar] line item insert failed", lineItemError);
  }

  await createGoogleEventBestEffort({
    organizationId: admin.organizationId,
    bookingId: booking.id,
    contactEmail,
    contactName,
    contactPhone,
    brokerage,
    streetAddress,
    unitNumber,
    city,
    postalCode,
    notes,
    selectedItems,
    scheduledAt,
    scheduledEndsAt,
  });

  await sendConfirmationBestEffort({
    email: contactEmail,
    organizationId: admin.organizationId,
    name: contactName,
    streetAddress: unitNumber
      ? `${streetAddress}, Unit ${unitNumber}`
      : streetAddress,
    scheduledAt,
    services: selectedItems.map((item) => item.name).join(", "),
  });

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/bookings");
  return { ok: true, bookingId: booking.id };
}

async function findOrCreateRealtor(args: {
  organizationId: string;
  email: string;
  fullName: string;
}): Promise<string | null> {
  const supabase = getServiceSupabase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("email", args.email)
    .limit(1)
    .maybeSingle<InsertedRow>();
  if (profile?.id) return profile.id;

  const { data: created, error } = await supabase.auth.admin.createUser({
    email: args.email,
    email_confirm: true,
    user_metadata: { full_name: args.fullName },
  });
  if (created.user) {
    await supabase
      .from("profiles")
      .update({
        organization_id: args.organizationId,
        full_name: args.fullName,
        role: "realtor",
      })
      .eq("id", created.user.id);
    return created.user.id;
  }

  if (error?.message.toLowerCase().includes("already")) {
    const { data: list } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const found = list?.users.find(
      (user) => user.email?.toLowerCase() === args.email,
    );
    if (found) return found.id;
  }

  if (error) {
    console.error("[admin-calendar] createUser failed", error);
  }
  return null;
}

async function findOrCreateProperty(args: {
  organizationId: string;
  ownerId: string;
  streetAddress: string;
  city: string;
  province: string;
  postalCode: string;
}): Promise<string | null> {
  const supabase = getServiceSupabase();
  const { data: existing } = await supabase
    .from("properties")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("owner_id", args.ownerId)
    .eq("street_address", args.streetAddress)
    .limit(1)
    .maybeSingle<InsertedRow>();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from("properties")
    .insert({
      organization_id: args.organizationId,
      owner_id: args.ownerId,
      street_address: args.streetAddress,
      city: args.city || null,
      province: args.province || null,
      postal_code: args.postalCode || null,
    })
    .select("id")
    .single<InsertedRow>();

  if (error || !created) {
    console.error("[admin-calendar] property insert failed", error);
    return null;
  }
  return created.id;
}

async function createGoogleEventBestEffort(args: {
  organizationId: string;
  bookingId: string;
  contactEmail: string;
  contactName: string;
  contactPhone: string;
  brokerage: string;
  streetAddress: string;
  unitNumber: string;
  city: string;
  postalCode: string;
  notes: string;
  selectedItems: CatalogItemRow[];
  scheduledAt: Date;
  scheduledEndsAt: string;
}) {
  try {
    const gcal = await getGoogleCalendarClient({
      organizationId: args.organizationId,
    });
    if (!gcal) return;

    const supabase = getServiceSupabase();
    const streetLine = args.unitNumber
      ? `${args.streetAddress}, Unit ${args.unitNumber}`
      : args.streetAddress;
    const addressLine = [streetLine, args.city, args.postalCode]
      .filter(Boolean)
      .join(", ");
    const serviceLabels = args.selectedItems.map((item) => item.name).join(", ");
    const event = await gcal.createEvent({
      summary: calendarShootTitle({
        realtor: args.contactName,
        services: serviceLabels,
        address: streetLine,
      }),
      location: addressLine,
      description:
        `Realtor: ${args.contactName}\nEmail: ${args.contactEmail}\n` +
        (args.contactPhone ? `Phone: ${args.contactPhone}\n` : "") +
        (args.brokerage ? `Brokerage: ${args.brokerage}\n` : "") +
        `Services: ${serviceLabels}\n` +
        (args.notes ? `\nNotes:\n${args.notes}\n` : ""),
      startISO: args.scheduledAt.toISOString(),
      endISO: args.scheduledEndsAt,
      attendeeEmail: args.contactEmail,
      attendeeName: args.contactName,
    });
    await supabase
      .from("bookings")
      .update({
        google_calendar_event_id: event.id,
        google_calendar_event_url: event.htmlLink,
      })
      .eq("organization_id", args.organizationId)
      .eq("id", args.bookingId);
  } catch (err) {
    console.warn("[admin-calendar] google calendar event create failed", err);
  }
}

function calendarShootTitle(args: {
  realtor: string;
  services: string;
  address: string;
}): string {
  return [args.realtor, args.services, args.address]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" - ");
}

async function sendConfirmationBestEffort(args: {
  email: string;
  organizationId: string;
  name: string;
  streetAddress: string;
  scheduledAt: Date;
  services: string;
}) {
  try {
    const whenLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TZ,
      dateStyle: "full",
      timeStyle: "short",
    }).format(args.scheduledAt);
    const emailSettings = await getOrganizationEmailSettings(args.organizationId);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    await sendEmail({
      to: args.email,
      subject: `Booking confirmed - ${args.streetAddress}`,
      organizationId: args.organizationId,
      html: `
        <p>Hi ${escapeHtml(args.name)},</p>
        <p>Your shoot is booked and on our calendar.</p>
        <p>
          <strong>Address:</strong> ${escapeHtml(args.streetAddress)}<br>
          <strong>When:</strong> ${escapeHtml(whenLabel)}<br>
          <strong>Services:</strong> ${escapeHtml(args.services)}
        </p>
        ${
          appUrl
            ? `<p>You can view this booking in your portal: <a href="${appUrl}/portal">${appUrl}/portal</a></p>`
            : ""
        }
        <p>— ${escapeHtml(emailSettings.organizationName)}</p>
      `,
    });
  } catch (err) {
    console.warn("[admin-calendar] confirmation email failed", err);
  }
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function parseOptionalInt(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
