import assert from "node:assert/strict";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

let syncBookingGoogleCalendarEvent;
let bookingGoogleCalendarEventId;
let GoogleCalendarRetiredEventIdError;
try {
  const importedSyncModule = await tsImport(
    "../lib/booking/calendar-event-sync.ts",
    import.meta.url,
  );
  syncBookingGoogleCalendarEvent =
    importedSyncModule.default.syncBookingGoogleCalendarEvent;
  const importedMutationModule = await tsImport(
    "../lib/integrations/google-calendar/event-mutation-core.ts",
    import.meta.url,
  );
  ({
    bookingGoogleCalendarEventId,
    GoogleCalendarRetiredEventIdError,
  } = importedMutationModule.default);
} catch {
  // RED: the shared synchronization and mutation boundaries do not exist yet.
}

const eventInput = {
  bookingId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  summary: "Realtor - The Blue Print, Aerial Add-on - 1 Main Street",
  description: "Services: The Blue Print\nAdd-ons: Aerial Add-on\n",
  location: "1 Main Street",
  startISO: "2026-08-26T15:00:00.000Z",
  endISO: "2026-08-26T16:50:00.000Z",
  clearAttendees: false,
};

function calendarClient({ updateError, createErrors = [], deleteError } = {}) {
  const calls = [];
  return {
    calls,
    async updateEvent(eventId, input) {
      calls.push(["update", eventId, input]);
      if (updateError) throw updateError;
      return { id: eventId, htmlLink: "https://calendar.test/existing" };
    },
    async createEvent(input, eventId) {
      calls.push(["create", input, eventId]);
      const error = createErrors.shift();
      if (error) throw error;
      return { id: eventId, htmlLink: "https://calendar.test/new" };
    },
    async deleteEvent(eventId, ownership) {
      calls.push(["delete", eventId, ownership]);
      if (deleteError) throw deleteError;
    },
  };
}

const missingEvent = (error) => error?.status === 404 || error?.status === 410;

test("rescheduling updates the complete existing event payload", async () => {
  assert.equal(typeof syncBookingGoogleCalendarEvent, "function");
  const client = calendarClient();
  let persisted = false;

  const result = await syncBookingGoogleCalendarEvent({
    client,
    previousEventId: "existing-event",
    eventInput,
    isMissingEvent: missingEvent,
    persistCreatedEvent: async () => {
      persisted = true;
      return "linked";
    },
  });

  assert.deepEqual(result, {
    ok: true,
    status: "updated",
    event: {
      id: "existing-event",
      htmlLink: "https://calendar.test/existing",
    },
  });
  assert.deepEqual(client.calls, [["update", "existing-event", eventInput]]);
  assert.equal(persisted, false);
});

test("a missing event is recreated idempotently and its linkage is persisted", async () => {
  const client = calendarClient({ updateError: { status: 404 } });
  const persisted = [];

  const result = await syncBookingGoogleCalendarEvent({
    client,
    previousEventId: "missing-event",
    eventInput,
    isMissingEvent: missingEvent,
    persistCreatedEvent: async (event) => {
      persisted.push(event);
      return "linked";
    },
  });

  const expectedId = bookingGoogleCalendarEventId(
    eventInput.bookingId,
    "missing-event",
    0,
  );
  assert.deepEqual(result, {
    ok: true,
    status: "created",
    event: { id: expectedId, htmlLink: "https://calendar.test/new" },
  });
  assert.deepEqual(persisted, [
    { id: expectedId, htmlLink: "https://calendar.test/new" },
  ]);
  assert.deepEqual(client.calls.map(([operation]) => operation), [
    "update",
    "create",
  ]);
  assert.equal(client.calls[1][2], expectedId);
});

test("retired deterministic ids advance without becoming random", async () => {
  const client = calendarClient({
    updateError: { status: 410 },
    createErrors: Array.from(
      { length: 4 },
      () => new GoogleCalendarRetiredEventIdError("retired"),
    ),
  });
  const result = await syncBookingGoogleCalendarEvent({
    client,
    previousEventId: "gone-event",
    eventInput,
    isMissingEvent: missingEvent,
    persistCreatedEvent: async () => "linked",
  });

  assert.equal(result.ok, true);
  assert.equal(client.calls.filter(([operation]) => operation === "create").length, 5);
  assert.equal(
    client.calls[1][2],
    bookingGoogleCalendarEventId(eventInput.bookingId, "gone-event", 0),
  );
  assert.equal(
    client.calls[5][2],
    bookingGoogleCalendarEventId(eventInput.bookingId, "gone-event", 4),
  );
});

test("durable retired ids skip beyond the former fixed generation window", async () => {
  const retiredEventIds = Array.from({ length: 40 }, (_, generation) =>
    bookingGoogleCalendarEventId(eventInput.bookingId, null, generation),
  );
  const client = calendarClient();
  const result = await syncBookingGoogleCalendarEvent({
    client,
    previousEventId: null,
    retiredEventIds,
    eventInput,
    isMissingEvent: missingEvent,
    persistCreatedEvent: async () => "linked",
  });

  assert.equal(result.ok, true);
  const creates = client.calls.filter(([operation]) => operation === "create");
  assert.equal(creates.length, 1);
  assert.equal(
    creates[0][2],
    bookingGoogleCalendarEventId(eventInput.bookingId, null, 40),
  );
});

test("definitive failed linkage strictly deletes the replacement", async () => {
  const client = calendarClient({ updateError: { status: 410 } });
  const result = await syncBookingGoogleCalendarEvent({
    client,
    previousEventId: "gone-event",
    eventInput,
    isMissingEvent: missingEvent,
    persistCreatedEvent: async () => "not_linked",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "linkage_failed");
  assert.equal(result.event.id, client.calls[1][2]);
  assert.deepEqual(client.calls.map(([operation]) => operation), [
    "update",
    "create",
    "delete",
  ]);
  assert.deepEqual(client.calls[2][2], {
    bookingId: eventInput.bookingId,
    organizationId: eventInput.organizationId,
  });
});

test("ambiguous linkage preserves the deterministic event for reconciliation", async () => {
  const client = calendarClient({ updateError: { status: 404 } });
  const result = await syncBookingGoogleCalendarEvent({
    client,
    previousEventId: "missing-event",
    eventInput,
    isMissingEvent: missingEvent,
    persistCreatedEvent: async () => "ambiguous",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "linkage_ambiguous");
  assert.equal(result.event.id, client.calls[1][2]);
  assert.deepEqual(client.calls.map(([operation]) => operation), [
    "update",
    "create",
  ]);
});

test("strict cleanup failures preserve the event id and report cleanup_failed", async () => {
  const client = calendarClient({
    updateError: { status: 410 },
    deleteError: new Error("delete denied"),
  });
  const result = await syncBookingGoogleCalendarEvent({
    client,
    previousEventId: "gone-event",
    eventInput,
    isMissingEvent: missingEvent,
    persistCreatedEvent: async () => "not_linked",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "cleanup_failed");
  assert.equal(result.event.id, client.calls[1][2]);
});

test("an unavailable client fails closed only when a remote event should exist", async () => {
  let persisted = false;
  const base = {
    client: null,
    eventInput,
    isMissingEvent: missingEvent,
    persistCreatedEvent: async () => {
      persisted = true;
      return "linked";
    },
  };
  assert.deepEqual(
    await syncBookingGoogleCalendarEvent({
      ...base,
      previousEventId: "expected-event",
    }),
    {
      ok: false,
      status: "client_unavailable",
      eventId: "expected-event",
    },
  );
  assert.deepEqual(
    await syncBookingGoogleCalendarEvent({
      ...base,
      previousEventId: null,
      unresolvedEventIds: ["ambiguous-event"],
    }),
    {
      ok: false,
      status: "client_unavailable",
      eventId: "ambiguous-event",
    },
  );
  assert.deepEqual(
    await syncBookingGoogleCalendarEvent({ ...base, previousEventId: null }),
    { ok: true, status: "not_configured" },
  );
  assert.equal(persisted, false);
});

test("non-missing update failures do not create a duplicate event", async () => {
  const client = calendarClient({ updateError: { status: 403 } });
  await assert.rejects(
    syncBookingGoogleCalendarEvent({
      client,
      previousEventId: "existing-event",
      eventInput,
      isMissingEvent: missingEvent,
      persistCreatedEvent: async () => "linked",
    }),
  );
  assert.deepEqual(client.calls.map(([operation]) => operation), ["update"]);
});
