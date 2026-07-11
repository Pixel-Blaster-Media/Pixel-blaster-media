"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  parseIGuideAlias,
  parseIGuidePortalId,
} from "@/lib/integrations/iguide/parse-id";
import {
  getReadyEventObject,
  type IGuideReadyEvent,
} from "@/lib/integrations/iguide/portal-client";
import {
  syncIGuideForBooking,
  syncIGuideFromReadyEvent,
} from "@/lib/integrations/iguide/sync";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

interface EventRow {
  id: string;
  payload_json: Json;
}

interface BookingRow {
  id: string;
  organization_id: string;
  property_id: string;
  iguide_id: string | null;
  iguide_portal_id: string | null;
}

export async function linkIGuideWebhookEvent(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();

  const eventId = String(formData.get("event_id") ?? "");
  const bookingId = String(formData.get("booking_id") ?? "");
  if (!eventId || !bookingId) {
    return { ok: false, error: "Pick an iGUIDE event and booking." };
  }

  const supabase = getServiceSupabase();
  const [eventResult, bookingResult] = await Promise.all([
    supabase
      .from("iguide_webhook_events")
      .select("id, payload_json")
      .eq("id", eventId)
      .eq("organization_id", admin.organizationId)
      .single<EventRow>(),
    supabase
      .from("bookings")
      .select("id, organization_id, property_id, iguide_id, iguide_portal_id")
      .eq("id", bookingId)
      .eq("organization_id", admin.organizationId)
      .single<BookingRow>(),
  ]);

  const { data: event, error: eventError } = eventResult;
  const { data: booking, error: bookingError } = bookingResult;

  if (eventError || !event) {
    return { ok: false, error: eventError?.message ?? "iGUIDE event not found." };
  }
  if (bookingError || !booking) {
    return { ok: false, error: bookingError?.message ?? "Booking not found." };
  }
  let readyEvent = toReadyEvent(event.payload_json);
  if (!readyEvent) {
    return { ok: false, error: "Stored iGUIDE event is not a ready event." };
  }

  // Stored inbox payloads intentionally redact the three-week access token.
  // Re-fetch the event when possible so a manual review can still save working
  // private gallery ZIP links instead of literally appending "[redacted]".
  if (readyEvent.workOrderId) {
    const fresh = await getReadyEventObject(
      readyEvent.iguideId,
      readyEvent.workOrderId,
      { organizationId: admin.organizationId },
    );
    if (fresh.ok && fresh.data) readyEvent = fresh.data;
  }
  readyEvent = withoutRedactedAccessToken(readyEvent);

  const result = await syncIGuideFromReadyEvent(
    booking,
    readyEvent,
    "admin_review",
    { organizationId: admin.organizationId },
  );
  if (!result.ok) {
    await supabase
      .from("iguide_webhook_events")
      .update({
        match_status: "failed",
        matched_booking_id: booking.id,
        match_source: "admin_review",
        last_error: result.error ?? "Sync failed.",
      })
      .eq("id", event.id)
      .eq("organization_id", admin.organizationId);
    return { ok: false, error: result.error ?? "Sync failed." };
  }

  await supabase
    .from("iguide_webhook_events")
    .update({
      match_status: "processed",
      matched_booking_id: booking.id,
      match_source: "admin_review",
      processed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", event.id)
    .eq("organization_id", admin.organizationId);

  revalidatePath("/admin/iguide");
  revalidatePath(`/admin/bookings/${booking.id}`);
  return { ok: true };
}

export async function ignoreIGuideWebhookEvent(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();

  const eventId = String(formData.get("event_id") ?? "");
  if (!eventId) return { ok: false, error: "Missing iGUIDE event." };

  const { error } = await getServiceSupabase()
    .from("iguide_webhook_events")
    .update({
      match_status: "ignored",
      match_source: "admin_ignored",
      last_error: null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .eq("organization_id", admin.organizationId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/iguide");
  return { ok: true };
}

export async function ignoreIGuideWebhookEvents(
  formData: FormData,
): Promise<void> {
  const admin = await requireAdmin();

  const eventIds = formData
    .getAll("event_id")
    .map(String)
    .filter(Boolean)
    .slice(0, 200);
  if (eventIds.length === 0) return;

  await getServiceSupabase()
    .from("iguide_webhook_events")
    .update({
      match_status: "ignored",
      match_source: "admin_bulk_ignored",
      last_error: null,
      processed_at: new Date().toISOString(),
    })
    .in("id", eventIds)
    .eq("organization_id", admin.organizationId);

  revalidatePath("/admin/iguide");
}

export async function linkManualIGuideToBooking(
  formData: FormData,
): Promise<void> {
  const admin = await requireAdmin();

  const bookingId = String(formData.get("booking_id") ?? "");
  const pasted = String(formData.get("iguide_ref") ?? "").trim();
  if (!bookingId || !pasted) return;

  const portalId = parseIGuidePortalId(pasted);
  const alias = portalId ? null : parseIGuideAlias(pasted);
  if (!portalId && !alias) return;

  const supabase = getServiceSupabase();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, organization_id, property_id, iguide_id, iguide_portal_id")
    .eq("id", bookingId)
    .eq("organization_id", admin.organizationId)
    .single<BookingRow>();

  if (!booking) return;

  const next = {
    ...booking,
    iguide_portal_id: portalId ?? booking.iguide_portal_id,
    iguide_id: alias ?? booking.iguide_id,
  };

  const { error } = await supabase
    .from("bookings")
    .update({
      ...(portalId ? { iguide_portal_id: portalId } : {}),
      ...(alias ? { iguide_id: alias } : {}),
    })
    .eq("id", booking.id)
    .eq("organization_id", admin.organizationId);

  if (!error) {
    await syncIGuideForBooking(next, { organizationId: admin.organizationId });
  }

  revalidatePath("/admin/iguide");
  revalidatePath(`/admin/bookings/${booking.id}`);
}

function toReadyEvent(value: Json): IGuideReadyEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (obj.type !== "ready" || typeof obj.iguideId !== "string") {
    return null;
  }
  return obj as unknown as IGuideReadyEvent;
}

function withoutRedactedAccessToken(event: IGuideReadyEvent): IGuideReadyEvent {
  if (event.authtoken !== "[redacted]") return event;
  const copy = { ...event };
  delete copy.authtoken;
  return copy;
}
