import {
  BookingGoogleCalendarCreateAttemptError,
  BookingGoogleCalendarIdAllocationError,
  syncBookingGoogleCalendarEvent,
  type BookingCalendarPersistenceResult,
  type BookingGoogleCalendarClient,
  type BookingGoogleCalendarEvent,
  type BookingGoogleCalendarEventInput,
} from "./calendar-event-sync.ts";

export interface StoredBookingCalendarProjection {
  eventInput: BookingGoogleCalendarEventInput;
  previousEventId: string | null;
  payloadFingerprint: string;
  persistenceVersion: string;
}

export interface StoredBookingCalendarState {
  eventId: string | null;
  payloadFingerprint: string;
}

export interface StoredBookingCalendarFailure {
  status: string;
  eventId: string | null;
  message: string;
  retiredEventIds?: readonly string[];
}

export interface StoredBookingCalendarReconciliationRow {
  payload: unknown;
}

export interface StoredBookingCalendarIntegrationJobRow {
  provider_external_id: string | null;
}

export function calendarCleanupCandidateIds(
  linkedEventId: string | null,
  reconciliationRows: readonly StoredBookingCalendarReconciliationRow[],
  integrationJobRows: readonly StoredBookingCalendarIntegrationJobRow[] = [],
): string[] {
  const eventIds = new Set<string>();
  const addEventId = (value: unknown) => {
    if (typeof value !== "string") return;
    const eventId = value.trim();
    if (!eventId || eventId.length > 1024) return;
    eventIds.add(eventId);
  };

  addEventId(linkedEventId);
  for (const row of reconciliationRows) {
    if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) {
      continue;
    }
    addEventId((row.payload as Record<string, unknown>).event_id);
  }
  for (const row of integrationJobRows) {
    addEventId(row.provider_external_id);
  }
  return [...eventIds];
}

export function calendarUnresolvedEventIds(
  reconciliationRows: readonly StoredBookingCalendarReconciliationRow[],
  integrationJobRows: readonly StoredBookingCalendarIntegrationJobRow[] = [],
): string[] {
  const retired = new Set(calendarRetiredEventIds(reconciliationRows));
  return calendarCleanupCandidateIds(
    null,
    reconciliationRows,
    integrationJobRows,
  ).filter((eventId) => !retired.has(eventId));
}

export function calendarRetiredEventIds(
  reconciliationRows: readonly StoredBookingCalendarReconciliationRow[],
): string[] {
  const eventIds = new Set<string>();
  const addEventId = (value: unknown) => {
    if (typeof value !== "string") return;
    const eventId = value.trim();
    if (!eventId || eventId.length > 1024) return;
    eventIds.add(eventId);
  };

  for (const row of reconciliationRows) {
    if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) {
      continue;
    }
    const payload = row.payload as Record<string, unknown>;
    if (payload.status === "linkage_failed") addEventId(payload.event_id);
    if (Array.isArray(payload.retired_event_ids)) {
      for (const eventId of payload.retired_event_ids.slice(0, 4096)) {
        addEventId(eventId);
      }
    }
  }
  return [...eventIds];
}

export type StoredBookingCalendarSyncResult =
  | {
      ok: true;
      status: "updated" | "created" | "not_configured";
      eventId?: string;
    }
  | { ok: false; status: string; eventId?: string };

export interface StoredBookingCalendarSyncDependencies {
  loadProjection(): Promise<StoredBookingCalendarProjection>;
  loadRetiredEventIds?(): Promise<readonly string[]>;
  loadUnresolvedEventIds?(): Promise<readonly string[]>;
  getClient(): Promise<BookingGoogleCalendarClient | null>;
  persistCreatedEvent(args: {
    projection: StoredBookingCalendarProjection;
    event: BookingGoogleCalendarEvent;
  }): Promise<BookingCalendarPersistenceResult>;
  loadCurrentState(): Promise<StoredBookingCalendarState | null>;
  recordFailure(failure: StoredBookingCalendarFailure): Promise<void>;
  recordRetiredEventIds?(eventIds: readonly string[]): Promise<void>;
  isMissingEvent(error: unknown): boolean;
}

export async function syncStoredBookingGoogleCalendarEventCore(
  { maxAttempts = 3 }: { maxAttempts?: number },
  dependencies: StoredBookingCalendarSyncDependencies,
): Promise<StoredBookingCalendarSyncResult> {
  const attempts = Math.max(1, Math.min(maxAttempts, 5));
  let finalFailure: StoredBookingCalendarFailure = {
    status: "sync_failed",
    eventId: null,
    message: "Google Calendar synchronization failed",
  };
  const retiredEventIds = new Set<string>();
  const newlyRetiredEventIds = new Set<string>();
  const unresolvedEventIds = new Set<string>();
  try {
    for (const eventId of (await dependencies.loadRetiredEventIds?.()) ?? []) {
      if (eventId) retiredEventIds.add(eventId);
    }
  } catch {
    return {
      ok: false,
      status: "retired_identity_load_failed",
    };
  }
  try {
    for (const eventId of (await dependencies.loadUnresolvedEventIds?.()) ?? []) {
      if (eventId) unresolvedEventIds.add(eventId);
    }
  } catch {
    return {
      ok: false,
      status: "unresolved_identity_load_failed",
    };
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const projection = await dependencies.loadProjection();
      const client = await dependencies.getClient();
      const result = await syncBookingGoogleCalendarEvent({
        client,
        previousEventId: projection.previousEventId,
        retiredEventIds: [...retiredEventIds],
        unresolvedEventIds: [...unresolvedEventIds],
        eventInput: projection.eventInput,
        isMissingEvent: dependencies.isMissingEvent,
        persistCreatedEvent: (event) =>
          dependencies.persistCreatedEvent({ projection, event }),
      });

      if ("retiredEventIds" in result) {
        for (const eventId of result.retiredEventIds ?? []) {
          if (!eventId) continue;
          if (!retiredEventIds.has(eventId)) newlyRetiredEventIds.add(eventId);
          retiredEventIds.add(eventId);
        }
      }

      if (!result.ok) {
        finalFailure = {
          status: result.status,
          eventId:
            "event" in result
              ? result.event.id
              : "eventId" in result
                ? (result.eventId ?? null)
                : null,
          message: `Google Calendar synchronization failed: ${result.status}`,
          retiredEventIds: [...retiredEventIds],
        };
        continue;
      }
      if (result.status === "not_configured") {
        return { ok: true, status: result.status };
      }

      const current = await dependencies.loadCurrentState();
      const expectedEventId = result.event.id;
      if (
        current?.eventId === expectedEventId &&
        current.payloadFingerprint === projection.payloadFingerprint
      ) {
        if (
          newlyRetiredEventIds.size > 0 &&
          dependencies.recordRetiredEventIds
        ) {
          try {
            await dependencies.recordRetiredEventIds([
              ...newlyRetiredEventIds,
            ]);
          } catch {
            return {
              ok: false,
              status: "reconciliation_persistence_failed",
              eventId: expectedEventId,
            };
          }
        }
        return {
          ok: true,
          status: result.status,
          eventId: result.event.id,
        };
      }

      finalFailure = {
        status: "stale_projection",
        eventId: expectedEventId,
        message: "Booking changed while Google Calendar was synchronizing",
      };
    } catch (error) {
      if (
        error instanceof BookingGoogleCalendarCreateAttemptError ||
        error instanceof BookingGoogleCalendarIdAllocationError
      ) {
        for (const eventId of error.retiredEventIds) {
          if (!eventId) continue;
          if (!retiredEventIds.has(eventId)) newlyRetiredEventIds.add(eventId);
          retiredEventIds.add(eventId);
        }
      }
      finalFailure = {
        status:
          error instanceof BookingGoogleCalendarIdAllocationError
            ? "event_id_allocation_failed"
            : "sync_failed",
        eventId:
          error instanceof BookingGoogleCalendarCreateAttemptError
            ? error.eventId
            : finalFailure.eventId,
        message: "Google Calendar synchronization failed",
        retiredEventIds: [...retiredEventIds],
      };
    }
  }

  finalFailure.retiredEventIds = [...retiredEventIds];
  try {
    await dependencies.recordFailure(finalFailure);
  } catch {
    return {
      ok: false,
      status: "reconciliation_persistence_failed",
      ...(finalFailure.eventId ? { eventId: finalFailure.eventId } : {}),
    };
  }
  return {
    ok: false,
    status: finalFailure.status,
    ...(finalFailure.eventId ? { eventId: finalFailure.eventId } : {}),
  };
}
