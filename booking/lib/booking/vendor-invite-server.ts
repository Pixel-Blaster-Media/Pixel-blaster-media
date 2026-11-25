import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";
import { getGoogleCalendarClient } from "@/lib/integrations/google-calendar/client";
import type { BookingVendorInviteRow } from "@/lib/supabase/database.types";
import { vendorEventId, vendorEventInput, vendorFingerprint, type VendorContact, type VendorInput, type VendorSchedule } from "./vendor-invite-core";

interface Scope { organizationId: string; bookingId: string }

export async function loadVendorContacts(organizationId: string): Promise<VendorContact[] | null> {
  const { data, error } = await getServiceSupabase().from("vendor_contacts")
    .select("email, name, logo_url").eq("organization_id", organizationId).order("name").limit(100).returns<VendorContact[]>();
  return error ? null : data ?? [];
}

async function loadSchedule(scope: Scope) {
  const { data, error } = await getServiceSupabase().from("bookings")
    .select("status, scheduled_at, scheduled_ends_at, unit_number, properties(street_address, city, province)")
    .eq("organization_id", scope.organizationId).eq("id", scope.bookingId).maybeSingle<VendorSchedule>();
  if (error || !data) throw new Error("Could not load the shoot.");
  return data;
}

async function loadRows(scope: Scope) {
  const { data, error } = await getServiceSupabase().from("booking_vendor_invites").select("*")
    .eq("organization_id", scope.organizationId).eq("booking_id", scope.bookingId).returns<BookingVendorInviteRow[]>();
  if (error) throw new Error("Could not load vendor invitations.");
  return data ?? [];
}

export async function getVendorInvitePanelData(scope: Scope) {
  const [booking, rows] = await Promise.all([loadSchedule(scope), loadRows(scope)]);
  return rows.flatMap((row) => {
    const input = vendorEventInput(booking, row);
    const synced = row.sent_fingerprint === vendorFingerprint(input);
    if (synced && !input) return [];
    return [{ id: row.id, email: row.email, name: row.name, logo_url: row.logo_url,
      instructions: row.instructions, status: synced ? "invited" : input ? "pending" : "cancelling" }];
  });
}

export async function attachVendor(scope: Scope, vendor: VendorInput) {
  const booking = await loadSchedule(scope);
  if (booking.status === "cancelled" || !booking.scheduled_at || !booking.scheduled_ends_at) throw new Error("This shoot isn’t scheduled.");
  const service = getServiceSupabase();
  const entries = await loadRows(scope);
  const existing = entries.find((row) => row.email === vendor.email);
  if (existing) {
    if (!existing.removed || existing.sent_fingerprint !== "cancelled") throw new Error("This email is already attached to the shoot.");
    // A re-invite after a completed cancellation needs a brand-new Google ID.
    const deleted = await service.from("booking_vendor_invites").delete().eq("organization_id", scope.organizationId)
      .eq("booking_id", scope.bookingId).eq("id", existing.id).eq("removed", true).eq("sent_fingerprint", "cancelled").is("lease_until", null);
    if (deleted.error) throw new Error("Could not reopen the vendor invitation.");
  }
  if (entries.filter((row) => !row.removed).length >= 5) throw new Error("You can add up to five vendors per shoot.");
  const { data: added, error } = await service.from("booking_vendor_invites").insert({
    organization_id: scope.organizationId, booking_id: scope.bookingId,
    email: vendor.email, name: vendor.name, logo_url: vendor.logo_url, instructions: vendor.instructions,
  }).select("id").maybeSingle();
  if (error || !added) throw new Error("Could not attach this vendor.");
  const saved = vendor.save ? await service.from("vendor_contacts").upsert({
    organization_id: scope.organizationId, email: vendor.email, name: vendor.name, logo_url: vendor.logo_url,
  }, { onConflict: "organization_id,email" }) : null;
  return { synced: await syncVendorInvite(scope, added.id), contactSaved: !saved?.error };
}

export async function removeVendor(scope: Scope, id: string) {
  const { error, data } = await getServiceSupabase().from("booking_vendor_invites").update({ removed: true })
    .eq("organization_id", scope.organizationId).eq("booking_id", scope.bookingId).eq("id", id).select("id").maybeSingle();
  if (error || !data) throw new Error("Could not remove the vendor.");
  return syncVendorInvite(scope, id);
}

export async function syncBookingVendorInvites(scope: Scope): Promise<boolean> {
  try {
    const rows = await loadRows(scope);
    if (!rows.length) return true;
    const booking = await loadSchedule(scope);
    const pending = rows.filter((row) => vendorFingerprint(vendorEventInput(booking, row)) !== row.sent_fingerprint);
    const results = await Promise.all(pending.map((row) => syncVendorInvite(scope, row.id)));
    return results.every(Boolean);
  } catch {
    return false;
  }
}

async function syncVendorInvite(scope: Scope, id: string): Promise<boolean> {
  const service = getServiceSupabase();
  const query = () => service.from("booking_vendor_invites")
    .update({ lease_until: new Date(Date.now() + 105_000).toISOString() })
    .eq("organization_id", scope.organizationId).eq("booking_id", scope.bookingId).eq("id", id);
  const { data, error } = await query().or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .select("*").maybeSingle<BookingVendorInviteRow>();
  if (error || !data?.lease_until) return false;
  const lease = data.lease_until;
  const row = { ...data };
  const persist = async (patch: Partial<BookingVendorInviteRow>) => {
    const { data, error } = await service.from("booking_vendor_invites").update(patch)
      .eq("organization_id", scope.organizationId).eq("booking_id", scope.bookingId)
      .eq("id", id).eq("lease_until", lease).select("*").maybeSingle<BookingVendorInviteRow>();
    if (error || !data) throw new Error("Could not persist vendor calendar state.");
    Object.assign(row, data);
  };
  try {
    // Re-read after the provider call so a move or removal during sync isn't lost.
    for (let pass = 0; pass < 2; pass++) {
      const input = vendorEventInput(await loadSchedule(scope), row);
      const fingerprint = vendorFingerprint(input);
      if (row.sent_fingerprint !== fingerprint) {
        if (input || row.calendar_connection_id !== null) {
          const client = await getGoogleCalendarClient({ organizationId: scope.organizationId });
          if (!client || (row.calendar_connection_id !== null &&
              (client.connectionId !== row.calendar_connection_id || client.calendarId !== row.calendar_id))) return false;
          const eventId = vendorEventId(row.id);
          if (input) {
            if (row.calendar_connection_id === null) {
              await persist({ calendar_connection_id: client.connectionId, calendar_id: client.calendarId });
            }
            if (row.removed) continue;
            if (row.google_event_id) {
              await client.updateEvent(eventId, input);
            } else {
              await client.createEvent(input, eventId);
            }
            await persist({ google_event_id: eventId, sent_fingerprint: fingerprint });
          } else {
            await client.deleteEvent(eventId, { bookingId: row.id, organizationId: scope.organizationId });
            await persist({ sent_fingerprint: fingerprint });
          }
        } else {
          await persist({ sent_fingerprint: fingerprint });
        }
      }
      const { data: latest, error: latestError } = await service.from("booking_vendor_invites").select("*")
        .eq("organization_id", scope.organizationId).eq("booking_id", scope.bookingId)
        .eq("id", id).eq("lease_until", lease).maybeSingle<BookingVendorInviteRow>();
      if (latestError || !latest) return false;
      Object.assign(row, latest);
      if (vendorFingerprint(vendorEventInput(await loadSchedule(scope), row)) === row.sent_fingerprint) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    await persist({ lease_until: null }).catch(() => {});
  }
}
