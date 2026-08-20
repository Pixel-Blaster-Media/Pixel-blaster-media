import "server-only";

import { loadBookingCalendarSelectionItems } from "@/lib/booking/calendar-event-items";
import {
  buildStoredBookingGoogleCalendarEventInput,
  storedBookingCalendarPayloadFingerprint,
  type StoredBookingCalendarProjectionRow,
} from "@/lib/booking/calendar-event-projection-core";
import {
  calendarCleanupCandidateIds,
  calendarRetiredEventIds,
  calendarUnresolvedEventIds,
  syncStoredBookingGoogleCalendarEventCore,
  type StoredBookingCalendarIntegrationJobRow,
  type StoredBookingCalendarProjection,
  type StoredBookingCalendarFailure,
  type StoredBookingCalendarReconciliationRow,
  type StoredBookingCalendarSyncResult,
} from "@/lib/booking/calendar-event-service-core";
import type {
  BookingCalendarPersistenceResult,
  BookingGoogleCalendarEvent,
} from "@/lib/booking/calendar-event-sync";
import {
  getGoogleCalendarConnection,
  getGoogleCalendarClient,
  GoogleCalendarError,
  type GoogleCalendarClient,
} from "@/lib/integrations/google-calendar/client";
import { getServiceSupabase } from "@/lib/supabase/server";

export type StoredBookingGoogleCalendarSyncResult =
  | StoredBookingCalendarSyncResult
  | { ok: true; status: "not_scheduled" };

const BOOKING_PROJECTION_SELECT =
  "id, organization_id, status, scheduled_at, scheduled_ends_at, services, add_ons, square_footage, unit_number, is_vacant, include_basement, client_notes, suppress_realtor_notifications, google_calendar_event_id, updated_at, properties(street_address, city, postal_code), profiles(email, full_name, phone, brokerage)";

export async function syncStoredBookingGoogleCalendarEvent(args: {
  organizationId: string;
  bookingId: string;
}): Promise<StoredBookingGoogleCalendarSyncResult> {
  const initial = await loadBookingProjectionRow(args);
  if (
    initial.status === "cancelled" ||
    !initial.scheduled_at ||
    !initial.scheduled_ends_at
  ) {
    return removeStoredBookingGoogleCalendarEvent(initial);
  }

  return syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 3 },
    {
      loadProjection: () => loadStableProjection(args),
      loadRetiredEventIds: async () =>
        calendarRetiredEventIds(await loadCalendarRetirementRows(args)),
      loadUnresolvedEventIds: async () =>
        calendarUnresolvedEventIds(
          await loadCalendarReconciliationRows(args),
          await loadCalendarIntegrationJobRows(args),
        ),
      getClient: () =>
        loadConfiguredBookingCalendarClient(args.organizationId),
      persistCreatedEvent: ({ projection, event }) =>
        persistCreatedEventLink({ args, projection, event }),
      loadCurrentState: async () => {
        const current = await loadStableProjection(args);
        return {
          eventId: current.previousEventId,
          payloadFingerprint: current.payloadFingerprint,
        };
      },
      recordFailure: (failure) => recordCalendarSyncFailure(args, failure),
      recordRetiredEventIds: (eventIds) =>
        recordCalendarRetiredEventIds(args, eventIds),
      isMissingEvent: (error) =>
        error instanceof GoogleCalendarError &&
        (error.status === 410 ||
          (error.status === 404 &&
            error.reason !== "identity_unverified_missing")),
    },
  );
}

async function loadStableProjection(args: {
  organizationId: string;
  bookingId: string;
}): Promise<StoredBookingCalendarProjection> {
  const before = await loadBookingProjectionRow(args);
  if (
    before.status === "cancelled" ||
    !before.scheduled_at ||
    !before.scheduled_ends_at
  ) {
    throw new Error("Booking no longer has a complete schedule");
  }
  const items = await loadBookingCalendarSelectionItems({
    organizationId: args.organizationId,
    bookingId: args.bookingId,
    services: before.services,
    addOns: before.add_ons,
  });
  const after = await loadBookingProjectionRow(args);
  if (
    before.updated_at !== after.updated_at ||
    before.google_calendar_event_id !== after.google_calendar_event_id ||
    storedBookingCalendarPayloadFingerprint(before, items) !==
      storedBookingCalendarPayloadFingerprint(after, items)
  ) {
    throw new Error("Booking changed while its Calendar projection was loading");
  }

  return {
    eventInput: buildStoredBookingGoogleCalendarEventInput({
      booking: before,
      items,
    }),
    previousEventId: before.google_calendar_event_id,
    payloadFingerprint: storedBookingCalendarPayloadFingerprint(before, items),
    persistenceVersion: before.updated_at,
  };
}

async function loadBookingProjectionRow(args: {
  organizationId: string;
  bookingId: string;
}): Promise<StoredBookingCalendarProjectionRow> {
  const { data, error } = await getServiceSupabase()
    .from("bookings")
    .select(BOOKING_PROJECTION_SELECT)
    .eq("organization_id", args.organizationId)
    .eq("id", args.bookingId)
    .maybeSingle<StoredBookingCalendarProjectionRow>();
  if (error || !data) {
    throw new Error("Could not load the tenant-scoped Calendar booking projection");
  }
  return data;
}

async function loadConfiguredBookingCalendarClient(
  organizationId: string,
): Promise<GoogleCalendarClient | null> {
  const connection = await getGoogleCalendarConnection({ organizationId });
  if (!connection) return null;

  const client = await getGoogleCalendarClient({ organizationId });
  if (!client) {
    throw new Error("Configured Google Calendar client is unavailable");
  }
  return client;
}

async function persistCreatedEventLink({
  args,
  projection,
  event,
}: {
  args: { organizationId: string; bookingId: string };
  projection: StoredBookingCalendarProjection;
  event: BookingGoogleCalendarEvent;
}): Promise<BookingCalendarPersistenceResult> {
  const service = getServiceSupabase();
  try {
    let query = service
      .from("bookings")
      .update({
        google_calendar_event_id: event.id,
        google_calendar_event_url: event.htmlLink,
      })
      .eq("organization_id", args.organizationId)
      .eq("id", args.bookingId)
      .eq("updated_at", projection.persistenceVersion);
    query = projection.previousEventId
      ? query.eq("google_calendar_event_id", projection.previousEventId)
      : query.is("google_calendar_event_id", null);
    const { data, error } = await query
      .select("id")
      .maybeSingle<{ id: string }>();
    if (!error && data) return "linked";
  } catch {
    // Re-read below distinguishes committed, rejected, and ambiguous writes.
  }

  try {
    const { data, error } = await service
      .from("bookings")
      .select("google_calendar_event_id")
      .eq("organization_id", args.organizationId)
      .eq("id", args.bookingId)
      .maybeSingle<{ google_calendar_event_id: string | null }>();
    if (error || !data) return "ambiguous";
    return data.google_calendar_event_id === event.id
      ? "linked"
      : "not_linked";
  } catch {
    return "ambiguous";
  }
}

async function loadCalendarReconciliationRows(args: {
  organizationId: string;
  bookingId: string;
}): Promise<StoredBookingCalendarReconciliationRow[]> {
  const { data, error } = await getServiceSupabase()
    .from("assistant_action_logs")
    .select("payload")
    .eq("organization_id", args.organizationId)
    .eq("target_booking_id", args.bookingId)
    .eq("action_type", "google_calendar_reconciliation_required")
    .eq("result_status", "failed")
    .returns<StoredBookingCalendarReconciliationRow[]>();
  if (error) {
    throw new Error("Could not load unresolved Calendar event identities");
  }
  return data ?? [];
}

async function loadCalendarRetirementRows(args: {
  organizationId: string;
  bookingId: string;
}): Promise<StoredBookingCalendarReconciliationRow[]> {
  const { data, error } = await getServiceSupabase()
    .from("assistant_action_logs")
    .select("payload")
    .eq("organization_id", args.organizationId)
    .eq("target_booking_id", args.bookingId)
    .in("action_type", [
      "google_calendar_reconciliation_required",
      "google_calendar_retired_ids",
    ])
    .returns<StoredBookingCalendarReconciliationRow[]>();
  if (error) {
    throw new Error("Could not load retired Calendar event identities");
  }
  return data ?? [];
}

async function loadCalendarIntegrationJobRows(args: {
  organizationId: string;
  bookingId: string;
}): Promise<StoredBookingCalendarIntegrationJobRow[]> {
  const { data, error } = await getServiceSupabase()
    .from("integration_jobs")
    .select("provider_external_id")
    .eq("organization_id", args.organizationId)
    .eq("booking_id", args.bookingId)
    .eq("job_type", "google_calendar.event.create")
    .not("provider_external_id", "is", null)
    .returns<StoredBookingCalendarIntegrationJobRow[]>();
  if (error) {
    throw new Error("Could not load provider-recorded Calendar event identities");
  }
  return data ?? [];
}

async function removeStoredBookingGoogleCalendarEvent(
  booking: StoredBookingCalendarProjectionRow,
): Promise<StoredBookingGoogleCalendarSyncResult> {
  const args = {
    organizationId: booking.organization_id,
    bookingId: booking.id,
  };
  let cleanupEventIds: string[] = [];
  try {
    const service = getServiceSupabase();
    const [reconciliationRows, integrationJobRows] = await Promise.all([
      loadCalendarReconciliationRows(args),
      loadCalendarIntegrationJobRows(args),
    ]);
    cleanupEventIds = calendarCleanupCandidateIds(
      booking.google_calendar_event_id,
      reconciliationRows,
      integrationJobRows,
    );
    if (cleanupEventIds.length === 0) {
      return { ok: true, status: "not_scheduled" };
    }

    const client = await loadConfiguredBookingCalendarClient(
      booking.organization_id,
    );
    if (!client) {
      await recordCalendarSyncFailure(args, {
        status: "client_unavailable",
        eventId: cleanupEventIds[0],
        message: "Calendar client unavailable while removing an unscheduled event",
      });
      return { ok: false, status: "client_unavailable" };
    }
    for (const eventId of cleanupEventIds) {
      await client.deleteEvent(eventId, {
        bookingId: booking.id,
        organizationId: booking.organization_id,
        allowMarkerlessLegacy: eventId === booking.google_calendar_event_id,
      });
    }
    if (booking.google_calendar_event_id) {
      const { data, error } = await service
        .from("bookings")
        .update({
          google_calendar_event_id: null,
          google_calendar_event_url: null,
        })
        .eq("organization_id", booking.organization_id)
        .eq("id", booking.id)
        .eq("google_calendar_event_id", booking.google_calendar_event_id)
        .eq("updated_at", booking.updated_at)
        .select("id")
        .maybeSingle<{ id: string }>();
      if (error || !data) {
        throw new Error("Could not clear the deleted Calendar link");
      }
    }
    return { ok: true, status: "not_scheduled" };
  } catch {
    const unresolvedEventId = booking.google_calendar_event_id ?? cleanupEventIds[0] ?? null;
    await recordCalendarSyncFailure(args, {
      status: "cleanup_failed",
      eventId: unresolvedEventId,
      message: "Google Calendar cleanup failed",
    });
    return {
      ok: false,
      status: "cleanup_failed",
      ...(unresolvedEventId ? { eventId: unresolvedEventId } : {}),
    };
  }
}

async function recordCalendarRetiredEventIds(
  args: { organizationId: string; bookingId: string },
  eventIds: readonly string[],
): Promise<void> {
  const retiredEventIds = [...new Set(eventIds.filter(Boolean))].slice(0, 4096);
  if (retiredEventIds.length === 0) return;

  const row = {
    organization_id: args.organizationId,
    action_type: "google_calendar_retired_ids",
    target_booking_id: args.bookingId,
    label: "Google Calendar retired event identities",
    details: "Retired deterministic Calendar identities retained for safe retries.",
    payload: {
      status: "retired_event_ids",
      event_id: null,
      retired_event_ids: retiredEventIds,
    },
    result_status: "success" as const,
    result_message: "Retired Calendar identities recorded.",
  };
  const service = getServiceSupabase();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await service.from("assistant_action_logs").insert(row);
    if (!error) return;
  }
  console.error("[google-calendar] retired identity persistence failed");
  throw new Error("Could not persist retired Calendar event identities");
}

async function recordCalendarSyncFailure(
  args: { organizationId: string; bookingId: string },
  failure: StoredBookingCalendarFailure,
): Promise<void> {
  const service = getServiceSupabase();
  const failureRow = {
    organization_id: args.organizationId,
    action_type: "google_calendar_reconciliation_required",
    target_booking_id: args.bookingId,
    label: "Google Calendar reconciliation required",
    details: "A booking Calendar mutation needs operator reconciliation.",
    payload: {
      status: failure.status,
      event_id: failure.eventId,
      retired_event_ids: [...(failure.retiredEventIds ?? [])].slice(0, 4096),
    },
    result_status: "failed" as const,
    result_message: failure.message.slice(0, 500),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await service.from("assistant_action_logs").insert(failureRow);
    if (!error) return;
  }

  console.error("[google-calendar] reconciliation persistence failed");
  throw new Error("Could not persist Google Calendar reconciliation evidence");
}
