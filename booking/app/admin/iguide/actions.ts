"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import type { IGuideReadyEvent } from "@/lib/integrations/iguide/portal-client";
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
  property_id: string;
  iguide_id: string | null;
  iguide_portal_id: string | null;
}

export async function linkIGuideWebhookEvent(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();

  const eventId = String(formData.get("event_id") ?? "");
  const bookingId = String(formData.get("booking_id") ?? "");
  if (!eventId || !bookingId) {
    return { ok: false, error: "Pick an iGUIDE event and booking." };
  }

  const supabase = getServiceSupabase();
  const [{ data: event }, { data: booking }] = await Promise.all([
    supabase
      .from("iguide_webhook_events")
      .select("id, payload_json")
      .eq("id", eventId)
      .single<EventRow>(),
    supabase
      .from("bookings")
      .select("id, property_id, iguide_id, iguide_portal_id")
      .eq("id", bookingId)
      .single<BookingRow>(),
  ]);

  if (!event) return { ok: false, error: "iGUIDE event not found." };
  if (!booking) return { ok: false, error: "Booking not found." };
  const readyEvent = toReadyEvent(event.payload_json);
  if (!readyEvent) {
    return { ok: false, error: "Stored iGUIDE event is not a ready event." };
  }

  const result = await syncIGuideFromReadyEvent(
    booking,
    readyEvent,
    "admin_review",
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
      .eq("id", event.id);
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
    .eq("id", event.id);

  revalidatePath("/admin/iguide");
  revalidatePath(`/admin/bookings/${booking.id}`);
  return { ok: true };
}

export async function ignoreIGuideWebhookEvent(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();

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
    .eq("id", eventId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/iguide");
  return { ok: true };
}

export async function ignoreIGuideWebhookEvents(
  formData: FormData,
): Promise<void> {
  await requireAdmin();

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
    .in("id", eventIds);

  revalidatePath("/admin/iguide");
}

export async function linkIGuidePortalTour(
  formData: FormData,
): Promise<void> {
  await requireAdmin();

  const bookingId = String(formData.get("booking_id") ?? "");
  const portalId = String(formData.get("portal_id") ?? "").trim();
  const alias = String(formData.get("alias") ?? "").trim() || null;
  if (!bookingId || !portalId) return;

  const supabase = getServiceSupabase();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, property_id, iguide_id, iguide_portal_id")
    .eq("id", bookingId)
    .single<BookingRow>();

  if (!booking) return;

  const { error } = await supabase
    .from("bookings")
    .update({
      iguide_portal_id: portalId,
      ...(alias ? { iguide_id: alias } : {}),
    })
    .eq("id", booking.id);

  if (!error) {
    await syncIGuideForBooking({
      ...booking,
      iguide_portal_id: portalId,
      iguide_id: alias ?? booking.iguide_id,
    });
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
