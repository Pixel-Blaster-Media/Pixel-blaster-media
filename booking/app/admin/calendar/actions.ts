"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { provisionRealtorAuthUser } from "@/lib/auth/provision-realtor";
import { rollbackProvisionedRealtor } from "@/lib/auth/rollback-provisioned-realtor";
import {
  BUSINESS_TZ,
  businessDateTimeLocalToUtc,
} from "@/lib/booking/availability";
import { syncStoredBookingGoogleCalendarEvent } from "@/lib/booking/calendar-event-service";
import { syncRealtorCalendarEventsBestEffort } from "@/lib/booking/realtor-calendar-fanout";
import {
  computeCartTotals,
  getActiveCatalog,
  validateCart,
  type CatalogItemRow,
} from "@/lib/booking/catalog";
import { ccRecipientsFor } from "@/lib/email/recipients";
import { sendEmail } from "@/lib/email/resend";
import { getOrganizationEmailSettings } from "@/lib/email/settings";

import { sendPushBestEffort } from "@/lib/notifications/push";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
  warning?: string;
  warningCode?:
    | "calendar_sync_failed"
    | "confirmation_email_failed"
    | "calendar_and_email_failed";
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

export async function updateCalendarSourcePreferences(
  formData: FormData,
): Promise<void> {
  const admin = await requireAdmin();
  const sourceId = Number(formData.get("source_id"));
  if (!Number.isInteger(sourceId)) return;

  const color = normalizeHexColor(str(formData, "source_color"));
  const supabase = getServiceSupabase();
  await supabase
    .from("google_calendar_connection")
    .update({
      source_color: color,
    })
    .eq("organization_id", admin.organizationId)
    .eq("id", sourceId);

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/settings/integrations");
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
      .is("archived_at", null)
      .ilike("full_name", pattern)
      .order("full_name", { ascending: true, nullsFirst: false })
      .limit(8)
      .returns<ProfileSearchRow[]>(),
    supabase
      .from("profiles")
      .select("id, email, full_name, phone, brokerage")
      .eq("organization_id", admin.organizationId)
      .eq("role", "realtor")
      .is("archived_at", null)
      .ilike("email", pattern)
      .order("email", { ascending: true })
      .limit(8)
      .returns<ProfileSearchRow[]>(),
  ]);

  const firstError = nameRes.error ?? emailRes.error;
  if (firstError) {
    console.warn("[admin-calendar] realtor search failed");
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
  const suppressRealtorNotifications =
    formData.get("suppress_realtor_notifications") === "on";
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
    .map((catalogItemId) => ({ catalogItemId, quantity: 1 }));
  const cartError = validateCart(cart, catalog);
  if (cartError) return { ok: false, error: cartError };

  const totals = computeCartTotals(cart, catalog);
  const duration = Math.max(totals.totalDurationMinutes, 60);
  // Admin-created shoots intentionally bypass availability checks so the
  // photographer can double-book or override blocked/external calendar time.
  // Realtor-facing booking flows still call isSlotAvailable before insert.

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
  const realtor = await findOrCreateRealtor({
    organizationId: admin.organizationId,
    email: contactEmail,
    fullName: contactName,
  });
  if (!realtor) {
    return {
      ok: false,
      error:
        "Could not create the realtor account. If this email already has a sign-in, contact support.",
    };
  }
  if ("error" in realtor) return { ok: false, error: realtor.error };
  const userId = realtor.userId;

  const { data: currentProfile, error: currentProfileError } = await supabase
    .from("profiles")
    .select("full_name, phone, brokerage, delivery_cc_emails")
    .eq("organization_id", admin.organizationId)
    .eq("id", userId)
    .maybeSingle<{
      full_name: string | null;
      phone: string | null;
      brokerage: string | null;
      delivery_cc_emails: string[] | null;
    }>();
  if (currentProfileError || !currentProfile) {
    if (realtor.newlyCreated) {
      const rollback = await rollbackProvisionedRealtor({
        userId,
        provisioningId: realtor.provisioningId!,
        context: "calendar-profile-read",
      });
      if (rollback.status !== "deleted") {
        return { ok: false, error: cleanupReference(rollback.reference) };
      }
    }
    return { ok: false, error: "Could not load the realtor profile." };
  }
  const profileChanged =
    (currentProfile.full_name ?? "") !== contactName ||
    (currentProfile.phone ?? "") !== contactPhone ||
    (currentProfile.brokerage ?? "") !== brokerage;

  const propertyId = await findOrCreateProperty({
    organizationId: admin.organizationId,
    ownerId: userId,
    streetAddress,
    city,
    province,
    postalCode,
  });
  if (!propertyId) {
    if (realtor.newlyCreated) {
      const rollback = await rollbackProvisionedRealtor({
        userId,
        provisioningId: realtor.provisioningId!,
        context: "calendar-property",
      });
      if (rollback.status !== "deleted") {
        return { ok: false, error: cleanupReference(rollback.reference) };
      }
    }
    return { ok: false, error: "Could not save property." };
  }

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
      allow_schedule_overlap: true,
      services: legacyServices,
      add_ons: legacyAddons,
      square_footage: squareFootage,
      unit_number: unitNumber || null,
      client_notes: notes || null,
      suppress_realtor_notifications: suppressRealtorNotifications,
    })
    .select("id")
    .single<InsertedRow>();

  if (bookingError || !booking) {
    console.error("[admin-calendar] booking insert failed");
    if (realtor.newlyCreated) {
      const rollback = await rollbackProvisionedRealtor({
        userId,
        propertyId,
        provisioningId: realtor.provisioningId!,
        context: "calendar-booking",
      });
      if (rollback.status !== "deleted") {
        return { ok: false, error: cleanupReference(rollback.reference) };
      }
    }
    if (bookingError?.code === "23P01") {
      return {
        ok: false,
        error:
          "The database still has the no-overlap guard. Apply migration 0037_allow_admin_overlap.sql to enable admin double-booking.",
      };
    }
    return { ok: false, error: "Could not save booking." };
  }

  const lineItems = selectedItems.map((item) => ({
    booking_id: booking.id,
    catalog_item_id: item.id,
    item_name: item.name,
    item_slug: item.slug,
    item_kind: item.kind,
    quantity: 1,
    unit_price_cents: item.price_cents,
    unit_duration_minutes: item.duration_minutes,
  }));
  const { error: lineItemError } = await supabase
    .from("booking_line_items")
    .insert(lineItems);
  const lineItemWarning = lineItemError
    ? "Booking saved, but item snapshots could not be recorded."
    : undefined;
  if (lineItemError) {
    console.warn("[admin-calendar] line item insert failed");
  }

  let profileUpdated = true;
  if (profileChanged) {
    const { data: updatedProfile, error: profileUpdateError } = await supabase
      .from("profiles")
      .update({
        full_name: contactName,
        phone: contactPhone || null,
        brokerage: brokerage || null,
      })
      .eq("organization_id", admin.organizationId)
      .eq("id", userId)
      .select("id")
      .maybeSingle<{ id: string }>();
    profileUpdated = !profileUpdateError && Boolean(updatedProfile);
  }
  const profileWarning =
    profileChanged && !profileUpdated
      ? "Booking saved, but the shared realtor profile could not be updated."
      : undefined;
  const siblingEventsSynced =
    !realtor.newlyCreated && profileChanged && profileUpdated
      ? await syncRealtorCalendarEventsBestEffort({
          organizationId: admin.organizationId,
          ownerId: userId,
          excludeBookingId: booking.id,
        })
      : true;
  const siblingCalendarWarning = !siblingEventsSynced
    ? "Booking saved, but one or more other shoots for this realtor did not sync to Google Calendar."
    : undefined;

  const calendarSynced = await createGoogleEventBestEffort({
    organizationId: admin.organizationId,
    bookingId: booking.id,
  });

  let confirmationWarning: string | undefined =
    !suppressRealtorNotifications && !profileUpdated
      ? "Booking saved, but the confirmation email was not sent because the realtor profile update failed."
      : undefined;
  if (!suppressRealtorNotifications && profileUpdated) {
    const confirmationSent = await sendConfirmationBestEffort({
      email: contactEmail,
      ccEmails: ccRecipientsFor(
        contactEmail,
        currentProfile.delivery_cc_emails,
      ),
      organizationId: admin.organizationId,
      name: contactName,
      streetAddress: unitNumber
        ? `${streetAddress}, Unit ${unitNumber}`
        : streetAddress,
      scheduledAt,
      services: selectedItems.map((item) => item.name).join(", "),
    });
    if (!confirmationSent) {
      confirmationWarning =
        "Booking saved, but the confirmation email was not sent.";
    }
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/bookings");
  return {
    ok: true,
    bookingId: booking.id,
    warning: combineWarnings(
      lineItemWarning,
      profileWarning,
      siblingCalendarWarning,
      calendarSynced
        ? undefined
        : "Booking saved, but Google Calendar did not sync. Check the event before the shoot.",
      confirmationWarning,
    ),
    warningCode:
      !calendarSynced && confirmationWarning
        ? "calendar_and_email_failed"
        : !calendarSynced
          ? "calendar_sync_failed"
          : confirmationWarning
            ? "confirmation_email_failed"
            : undefined,
  };
}

interface BookingForRescheduleRow {
  id: string;
  status: string;
  services: string[] | null;
  add_ons: string[] | null;
  scheduled_at: string | null;
  scheduled_ends_at: string | null;
  owner_id: string;
  unit_number: string | null;
  client_notes: string | null;
  google_calendar_event_id: string | null;
  suppress_realtor_notifications: boolean;
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

interface CalendarBlockForMoveRow {
  id: string;
  starts_at: string;
  ends_at: string;
  label: string | null;
}

/**
 * Drag-to-reschedule from the calendar week view. The client sends the
 * target day (business-TZ date) and minutes-from-midnight snapped to
 * the 30-minute grid; duration is carried over from the booking itself
 * so nothing else about the shoot changes.
 */
export async function rescheduleCalendarShoot(
  bookingId: string,
  dateInput: string,
  startMinutes: number,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return { ok: false, error: "Invalid day." };
  }
  if (
    !Number.isInteger(startMinutes) ||
    startMinutes < 0 ||
    startMinutes >= 24 * 60
  ) {
    return { ok: false, error: "Invalid time." };
  }
  const hour = String(Math.floor(startMinutes / 60)).padStart(2, "0");
  const minute = String(startMinutes % 60).padStart(2, "0");
  const scheduledAt = businessDateTimeLocalToUtc(
    `${dateInput}T${hour}:${minute}`,
  );
  if (!scheduledAt) return { ok: false, error: "Invalid time." };

  const supabase = getServiceSupabase();
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, status, services, add_ons, scheduled_at, scheduled_ends_at, owner_id, unit_number, client_notes, google_calendar_event_id, suppress_realtor_notifications, properties(street_address, city, postal_code), profiles(email, full_name, phone, brokerage)",
    )
    .eq("id", bookingId)
    .eq("organization_id", admin.organizationId)
    .single<BookingForRescheduleRow>();

  if (bookingError || !booking) {
    return { ok: false, error: "Booking not found." };
  }
  if (booking.status === "cancelled") {
    return { ok: false, error: "That booking is cancelled." };
  }
  if (!booking.scheduled_at) {
    return { ok: false, error: "That booking has no time set yet." };
  }

  const previousStart = new Date(booking.scheduled_at);
  const durationMinutes = booking.scheduled_ends_at
    ? Math.max(
        Math.round(
          (new Date(booking.scheduled_ends_at).getTime() -
            previousStart.getTime()) /
            60_000,
        ),
        30,
      )
    : 60;
  const scheduledEndsAt = new Date(
    scheduledAt.getTime() + durationMinutes * 60_000,
  );

  // Admin calendar moves may intentionally overlap (for example, over the
  // tail of a shoot that will finish early). Realtor-facing writes keep this
  // flag false and remain protected by the database overlap trigger.
  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      scheduled_at: scheduledAt.toISOString(),
      scheduled_ends_at: scheduledEndsAt.toISOString(),
      allow_schedule_overlap: true,
    })
    .eq("id", booking.id)
    .eq("organization_id", admin.organizationId);
  if (updateError) {
    if (updateError.code === "23P01") {
      return {
        ok: false,
        error:
          "The database still has the no-overlap guard. Apply migration 0037_allow_admin_overlap.sql to enable double-booking.",
      };
    }
    return { ok: false, error: "Could not reschedule booking." };
  }

  // Re-project the complete stored booking so the reschedule also repairs old
  // titles/descriptions without dropping creation-only metadata.
  let warning: string | undefined;
  try {
    const syncResult = await syncStoredBookingGoogleCalendarEvent({
      organizationId: admin.organizationId,
      bookingId: booking.id,
    });
    if (!syncResult.ok) {
      throw new Error(`Google Calendar sync failed: ${syncResult.status}`);
    }
  } catch {
    warning =
      "The booking moved, but Google Calendar sync did not finish. Check the event in Google Calendar before trying again.";
    console.warn("[admin-calendar] google calendar reschedule failed");
  }

  await supabase.from("assistant_action_logs").insert({
    organization_id: admin.organizationId,
    actor_profile_id: admin.userId,
    action_type: "calendar_reschedule",
    target_booking_id: booking.id,
    target_realtor_id: booking.owner_id,
    label: "Calendar reschedule",
    details: `Moved ${booking.properties?.street_address ?? "booking"} to ${dateInput} ${hour}:${minute}.`,
    payload: {
      old_scheduled_at: booking.scheduled_at,
      old_scheduled_ends_at: booking.scheduled_ends_at,
      new_scheduled_at: scheduledAt.toISOString(),
      new_scheduled_ends_at: scheduledEndsAt.toISOString(),
    },
    result_status: "success",
    result_message:
      warning ?? "Booking moved from the admin calendar.",
    undo_payload: {
      booking_id: booking.id,
      scheduled_at: booking.scheduled_at,
      scheduled_ends_at: booking.scheduled_ends_at,
    },
  });

  const whenLabel = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(scheduledAt);
  await sendPushBestEffort(admin.organizationId, {
    title: "Booking rescheduled",
    body: `${booking.properties?.street_address ?? "Booking"} · ${whenLabel}`,
    url: `/admin/bookings/${booking.id}`,
    tag: `booking-rescheduled-${booking.id}`,
  });

  revalidatePath("/admin/calendar");
  revalidatePath("/admin/bookings");
  revalidatePath(`/admin/bookings/${booking.id}`);
  return { ok: true, warning, bookingId: booking.id };
}

/**
 * Drag-to-move a private blocked-time item. The block keeps its original
 * duration; only the start/end timestamps shift.
 */
export async function moveCalendarBlock(
  blockId: string,
  dateInput: string,
  startMinutes: number,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return { ok: false, error: "Invalid day." };
  }
  if (
    !Number.isInteger(startMinutes) ||
    startMinutes < 0 ||
    startMinutes >= 24 * 60
  ) {
    return { ok: false, error: "Invalid time." };
  }

  const hour = String(Math.floor(startMinutes / 60)).padStart(2, "0");
  const minute = String(startMinutes % 60).padStart(2, "0");
  const startsAt = businessDateTimeLocalToUtc(`${dateInput}T${hour}:${minute}`);
  if (!startsAt) return { ok: false, error: "Invalid time." };

  const supabase = getServiceSupabase();
  const { data: block, error: blockError } = await supabase
    .from("calendar_blocks")
    .select("id, starts_at, ends_at, label")
    .eq("id", blockId)
    .eq("organization_id", admin.organizationId)
    .single<CalendarBlockForMoveRow>();

  if (blockError || !block) {
    return { ok: false, error: "Blocked time not found." };
  }

  const oldStart = new Date(block.starts_at);
  const oldEnd = new Date(block.ends_at);
  const durationMinutes = Math.max(
    Math.round((oldEnd.getTime() - oldStart.getTime()) / 60_000),
    5,
  );
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  const { error: updateError } = await supabase
    .from("calendar_blocks")
    .update({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", block.id)
    .eq("organization_id", admin.organizationId);

  if (updateError) return { ok: false, error: "Could not move blocked time." };

  await supabase.from("assistant_action_logs").insert({
    organization_id: admin.organizationId,
    actor_profile_id: admin.userId,
    action_type: "calendar_block_drag_move",
    label: "Calendar block drag move",
    details: `Moved ${block.label ?? "blocked time"} to ${dateInput} ${hour}:${minute}.`,
    payload: {
      block_id: block.id,
      old_starts_at: block.starts_at,
      old_ends_at: block.ends_at,
      new_starts_at: startsAt.toISOString(),
      new_ends_at: endsAt.toISOString(),
    },
    result_status: "success",
    result_message: "Blocked time moved from the calendar week view.",
    undo_payload: {
      block_id: block.id,
      starts_at: block.starts_at,
      ends_at: block.ends_at,
    },
  });

  revalidatePath("/admin/settings/availability");
  revalidatePath("/admin/calendar");
  return { ok: true };
}

function cleanupReference(reference: string | null): string {
  return (
    "The booking was not completed. Do not retry; email info@pixelblastermedia.com and include this reference." +
    (reference ? ` Reference: ${reference}` : "")
  );
}

async function findOrCreateRealtor(args: {
  organizationId: string;
  email: string;
  fullName: string;
}): Promise<
  | {
      userId: string;
      newlyCreated: boolean;
      provisioningId: string | null;
    }
  | { error: string }
  | null
> {
  const supabase = getServiceSupabase();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id, role, archived_at")
    .ilike("email", args.email)
    .maybeSingle<{
      id: string;
      organization_id: string;
      role: "admin" | "realtor";
      archived_at: string | null;
    }>();
  if (profileError) {
    console.error("[admin-calendar] existing profile lookup failed");
    return null;
  }
  if (profile?.id) {
    if (
      profile.organization_id !== args.organizationId ||
      profile.role !== "realtor" ||
      profile.archived_at
    ) {
      return null;
    }
    return { userId: profile.id, newlyCreated: false, provisioningId: null };
  }

  const provisioned = await provisionRealtorAuthUser({
    service: supabase,
    email: args.email,
    fullName: args.fullName,
    organizationId: args.organizationId,
    context: "calendar-create",
  });
  if (provisioned.ok) {
    const provisioningId = provisioned.provisioningId;
    const { data: provisionedProfile, error: provisionError } = await supabase
      .from("profiles")
      .update({
        organization_id: args.organizationId,
        full_name: args.fullName,
        role: "realtor",
        archived_at: null,
      })
      .eq("id", provisioned.userId)
      .eq("role", "realtor")
      .is("archived_at", null)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (provisionError || !provisionedProfile) {
      console.error("[admin-calendar] trusted realtor profile verification failed");
      const rollback = await rollbackProvisionedRealtor({
        userId: provisioned.userId,
        provisioningId,
        context: "calendar-profile-verification",
      });
      if (rollback.status !== "deleted") {
        console.error("[admin-calendar] profile verification cleanup failed");
        return { error: cleanupReference(rollback.reference) };
      }
      return null;
    }
    return {
      userId: provisionedProfile.id,
      newlyCreated: true,
      provisioningId,
    };
  }
  return {
    error: `${provisioned.message} Reference: ${provisioned.reference}`,
  };
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
    console.error("[admin-calendar] property insert failed");
    return null;
  }
  return created.id;
}

async function createGoogleEventBestEffort(args: {
  organizationId: string;
  bookingId: string;
}): Promise<boolean> {
  try {
    const result = await syncStoredBookingGoogleCalendarEvent({
      organizationId: args.organizationId,
      bookingId: args.bookingId,
    });
    return result.ok;
  } catch {
    console.warn("[admin-calendar] google calendar event create failed");
    return false;
  }
}

async function sendConfirmationBestEffort(args: {
  email: string;
  ccEmails: string[];
  organizationId: string;
  name: string;
  streetAddress: string;
  scheduledAt: Date;
  services: string;
}): Promise<boolean> {
  try {
    const whenLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TZ,
      dateStyle: "full",
      timeStyle: "short",
    }).format(args.scheduledAt);
    const emailSettings = await getOrganizationEmailSettings(args.organizationId);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const result = await sendEmail({
      to: args.email,
      ...(args.ccEmails.length > 0 ? { cc: args.ccEmails } : {}),
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
    return result.ok && !result.skipped;
  } catch {
    console.warn("[admin-calendar] confirmation email failed");
    return false;
  }
}

function combineWarnings(
  ...warnings: Array<string | null | undefined | false>
): string | undefined {
  const unique = [...new Set(warnings.filter((warning): warning is string => Boolean(warning)))];
  return unique.length > 0 ? unique.join(" ") : undefined;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function normalizeHexColor(value: string): string {
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : "#2f80b7";
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
