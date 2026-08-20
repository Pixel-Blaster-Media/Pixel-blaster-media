import {
  bookingGoogleCalendarEventId,
  GoogleCalendarRetiredEventIdError,
} from "../integrations/google-calendar/event-mutation-core.ts";

export interface BookingGoogleCalendarEventInput {
  bookingId: string;
  organizationId: string;
  summary: string;
  description?: string;
  location?: string;
  startISO: string;
  endISO: string;
  attendeeEmail?: string;
  attendeeName?: string;
  clearAttendees: boolean;
}

export interface BookingGoogleCalendarEvent {
  id: string;
  htmlLink: string;
}

export interface BookingGoogleCalendarClient {
  createEvent(
    input: BookingGoogleCalendarEventInput,
    eventId?: string,
  ): Promise<BookingGoogleCalendarEvent>;
  updateEvent(
    eventId: string,
    input: BookingGoogleCalendarEventInput,
  ): Promise<BookingGoogleCalendarEvent>;
  deleteEvent(
    eventId: string,
    ownership: { bookingId: string; organizationId: string },
  ): Promise<void>;
}

export type BookingCalendarPersistenceResult =
  | "linked"
  | "not_linked"
  | "ambiguous";

export type BookingGoogleCalendarSyncResult =
  | {
      ok: true;
      status: "updated" | "created";
      event: BookingGoogleCalendarEvent;
      retiredEventIds?: readonly string[];
    }
  | { ok: true; status: "not_configured" }
  | { ok: false; status: "client_unavailable"; eventId?: string }
  | {
      ok: false;
      status: "linkage_failed" | "linkage_ambiguous" | "cleanup_failed";
      event: BookingGoogleCalendarEvent;
      retiredEventIds?: readonly string[];
    };

export class BookingGoogleCalendarCreateAttemptError extends Error {
  readonly eventId: string;
  readonly retiredEventIds: readonly string[];

  constructor(eventId: string, retiredEventIds: readonly string[] = []) {
    super("Google Calendar deterministic event creation did not complete");
    this.name = "BookingGoogleCalendarCreateAttemptError";
    this.eventId = eventId;
    this.retiredEventIds = [...retiredEventIds];
  }
}

export class BookingGoogleCalendarIdAllocationError extends Error {
  readonly retiredEventIds: readonly string[];

  constructor(retiredEventIds: readonly string[]) {
    super("Could not allocate a Google Calendar event id");
    this.name = "BookingGoogleCalendarIdAllocationError";
    this.retiredEventIds = [...retiredEventIds];
  }
}

// A failed linkage CAS may require strict compensation, and Google permanently
// retires caller-supplied IDs after deletion. Keep a generous but bounded
// deterministic generation window so repeated repaired writes remain recoverable.
const MAX_EVENT_ID_GENERATIONS = 4096;
const UNKNOWN_RETIRED_ID_PROBE_BUDGET = 32;

export async function syncBookingGoogleCalendarEvent({
  client,
  eventInput,
  previousEventId,
  retiredEventIds = [],
  unresolvedEventIds = [],
  isMissingEvent,
  persistCreatedEvent,
}: {
  client: BookingGoogleCalendarClient | null;
  previousEventId: string | null;
  retiredEventIds?: readonly string[];
  unresolvedEventIds?: readonly string[];
  eventInput: BookingGoogleCalendarEventInput;
  isMissingEvent: (error: unknown) => boolean;
  persistCreatedEvent: (
    event: BookingGoogleCalendarEvent,
  ) => Promise<BookingCalendarPersistenceResult>;
}): Promise<BookingGoogleCalendarSyncResult> {
  if (!client) {
    const unresolvedEventId = unresolvedEventIds
      .map((eventId) => eventId.trim())
      .find((eventId) => eventId.length > 0 && eventId.length <= 1024);
    const expectedEventId = previousEventId ?? unresolvedEventId;
    if (expectedEventId) {
      return {
        ok: false,
        status: "client_unavailable",
        eventId: expectedEventId,
      };
    }
    return { ok: true, status: "not_configured" };
  }

  if (previousEventId) {
    try {
      const event = await client.updateEvent(previousEventId, eventInput);
      return { ok: true, status: "updated", event };
    } catch (error) {
      if (!isMissingEvent(error)) throw error;
    }
  }

  const retiredEventIdSet = new Set(retiredEventIds);
  const generationLimit = Math.min(
    MAX_EVENT_ID_GENERATIONS,
    retiredEventIdSet.size + UNKNOWN_RETIRED_ID_PROBE_BUDGET,
  );
  let event: BookingGoogleCalendarEvent | null = null;
  for (let attempt = 0; attempt < generationLimit; attempt += 1) {
    const eventId = bookingGoogleCalendarEventId(
      eventInput.bookingId,
      previousEventId,
      attempt,
    );
    if (retiredEventIdSet.has(eventId)) continue;
    try {
      event = await client.createEvent(eventInput, eventId);
      break;
    } catch (error) {
      if (error instanceof GoogleCalendarRetiredEventIdError) {
        retiredEventIdSet.add(eventId);
        continue;
      }
      // A failed/ambiguous POST (including 409 followed by ownership-unverified
      // 404) may still have created this deterministic id remotely. Preserve
      // the exact candidate without retaining the private provider error.
      throw new BookingGoogleCalendarCreateAttemptError(
        eventId,
        [...retiredEventIdSet],
      );
    }
  }
  if (!event) {
    throw new BookingGoogleCalendarIdAllocationError([...retiredEventIdSet]);
  }

  let persistence: BookingCalendarPersistenceResult;
  try {
    persistence = await persistCreatedEvent(event);
  } catch {
    persistence = "ambiguous";
  }

  if (persistence === "linked") {
    return {
      ok: true,
      status: "created",
      event,
      ...(retiredEventIdSet.size > 0
        ? { retiredEventIds: [...retiredEventIdSet] }
        : {}),
    };
  }
  if (persistence === "ambiguous") {
    return {
      ok: false,
      status: "linkage_ambiguous",
      event,
      ...(retiredEventIdSet.size > 0
        ? { retiredEventIds: [...retiredEventIdSet] }
        : {}),
    };
  }

  try {
    await client.deleteEvent(event.id, {
      bookingId: eventInput.bookingId,
      organizationId: eventInput.organizationId,
    });
  } catch {
    return {
      ok: false,
      status: "cleanup_failed",
      event,
      ...(retiredEventIdSet.size > 0
        ? { retiredEventIds: [...retiredEventIdSet] }
        : {}),
    };
  }
  retiredEventIdSet.add(event.id);
  return {
    ok: false,
    status: "linkage_failed",
    event,
    retiredEventIds: [...retiredEventIdSet],
  };
}
