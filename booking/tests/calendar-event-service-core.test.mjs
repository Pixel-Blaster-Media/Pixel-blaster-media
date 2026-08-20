import assert from "node:assert/strict";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

let syncStoredBookingGoogleCalendarEventCore;
let calendarCleanupCandidateIds;
let calendarRetiredEventIds;
let GoogleCalendarRetiredEventIdError;
try {
  const imported = await tsImport(
    "../lib/booking/calendar-event-service-core.ts",
    import.meta.url,
  );
  syncStoredBookingGoogleCalendarEventCore =
    imported.default.syncStoredBookingGoogleCalendarEventCore;
  calendarCleanupCandidateIds = imported.default.calendarCleanupCandidateIds;
  calendarRetiredEventIds = imported.default.calendarRetiredEventIds;
  const mutationCore = await tsImport(
    "../lib/integrations/google-calendar/event-mutation-core.ts",
    import.meta.url,
  );
  GoogleCalendarRetiredEventIdError =
    mutationCore.default.GoogleCalendarRetiredEventIdError;
} catch {
  // RED: the convergent stored-booking sync core does not exist yet.
}

function input(label) {
  return {
    bookingId: "22222222-2222-4222-8222-222222222222",
    organizationId: "11111111-1111-4111-8111-111111111111",
    summary: `Realtor - ${label} - 1 Main Street`,
    description: `Services: ${label}\n`,
    location: "1 Main Street",
    startISO: "2026-08-26T15:00:00.000Z",
    endISO: "2026-08-26T16:00:00.000Z",
    clearAttendees: true,
  };
}

function client() {
  const calls = [];
  return {
    calls,
    async updateEvent(eventId, eventInput) {
      calls.push(["update", eventId, eventInput]);
      return { id: eventId, htmlLink: `https://calendar.test/${eventId}` };
    },
    async createEvent(eventInput, eventId) {
      calls.push(["create", eventId, eventInput]);
      return { id: eventId, htmlLink: `https://calendar.test/${eventId}` };
    },
    async deleteEvent(eventId) {
      calls.push(["delete", eventId]);
    },
  };
}

test("stored sync retries with a fresh projection when booking-visible data changes", async () => {
  assert.equal(typeof syncStoredBookingGoogleCalendarEventCore, "function");
  const google = client();
  const projections = [
    {
      eventInput: input("Old package"),
      previousEventId: "existing-event",
      payloadFingerprint: "old",
      persistenceVersion: "v1",
    },
    {
      eventInput: input("New package, Aerial Add-on"),
      previousEventId: "existing-event",
      payloadFingerprint: "new",
      persistenceVersion: "v2",
    },
  ];
  const currentStates = [
    { eventId: "existing-event", payloadFingerprint: "new" },
    { eventId: "existing-event", payloadFingerprint: "new" },
  ];
  const failures = [];

  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 3 },
    {
      loadProjection: async () => projections.shift(),
      getClient: async () => google,
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => currentStates.shift(),
      recordFailure: async (failure) => failures.push(failure),
      isMissingEvent: () => false,
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "updated");
  assert.equal(google.calls.length, 2);
  assert.equal(google.calls[0][2].summary, "Realtor - Old package - 1 Main Street");
  assert.equal(
    google.calls[1][2].summary,
    "Realtor - New package, Aerial Add-on - 1 Main Street",
  );
  assert.deepEqual(failures, []);
});

test("ambiguous linkage retries the same deterministic event and converges", async () => {
  const google = client();
  const projection = {
    eventInput: input("The Blue Print, Aerial Add-on"),
    previousEventId: null,
    payloadFingerprint: "stable",
    persistenceVersion: "v1",
  };
  let persistAttempts = 0;
  const failures = [];

  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 3 },
    {
      loadProjection: async () => projection,
      getClient: async () => google,
      persistCreatedEvent: async () => {
        persistAttempts += 1;
        return persistAttempts === 1 ? "ambiguous" : "linked";
      },
      loadCurrentState: async () => ({
        eventId: google.calls.at(-1)?.[1] ?? null,
        payloadFingerprint: "stable",
      }),
      recordFailure: async (failure) => failures.push(failure),
      isMissingEvent: () => false,
    },
  );

  assert.equal(result.ok, true);
  assert.equal(persistAttempts, 2);
  const creates = google.calls.filter(([operation]) => operation === "create");
  assert.equal(creates.length, 2);
  assert.equal(creates[0][1], creates[1][1]);
  assert.deepEqual(failures, []);
});

test("exhausted failures are durably reported with the deterministic event id", async () => {
  const google = client();
  const projection = {
    eventInput: input("The Blue Print, Aerial Add-on"),
    previousEventId: null,
    payloadFingerprint: "stable",
    persistenceVersion: "v1",
  };
  const failures = [];

  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 2 },
    {
      loadProjection: async () => projection,
      getClient: async () => google,
      persistCreatedEvent: async () => "ambiguous",
      loadCurrentState: async () => ({
        eventId: null,
        payloadFingerprint: "stable",
      }),
      recordFailure: async (failure) => failures.push(failure),
      isMissingEvent: () => false,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "linkage_ambiguous");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].status, "linkage_ambiguous");
  assert.match(failures[0].eventId, /^[a-v0-9]+$/);
});

test("ambiguous create transport failures retain the exact attempted deterministic id", async () => {
  const google = client();
  google.createEvent = async (eventInput, eventId) => {
    google.calls.push(["create", eventId, eventInput]);
    throw new Error("private-provider-body token=secret");
  };
  const failures = [];

  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 1 },
    {
      loadProjection: async () => ({
        eventInput: input("The Blue Print"),
        previousEventId: null,
        payloadFingerprint: "stable",
        persistenceVersion: "v1",
      }),
      getClient: async () => google,
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => null,
      recordFailure: async (failure) => failures.push(failure),
      isMissingEvent: () => false,
    },
  );

  const attemptedEventId = google.calls[0][1];
  assert.match(attemptedEventId, /^[a-v0-9]+$/);
  assert.deepEqual(result, {
    ok: false,
    status: "sync_failed",
    eventId: attemptedEventId,
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].eventId, attemptedEventId);
  assert.equal(
    calendarCleanupCandidateIds(null, [
      { payload: { event_id: failures[0].eventId } },
    ])[0],
    attemptedEventId,
  );
  assert.doesNotMatch(failures[0].message, /private-provider-body|secret/);
});

test("retired identity lookup failures stop before any provider mutation", async () => {
  const google = client();
  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 1 },
    {
      loadProjection: async () => {
        throw new Error("projection should not load");
      },
      loadRetiredEventIds: async () => {
        throw new Error("database unavailable");
      },
      getClient: async () => google,
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => null,
      recordFailure: async () => {},
      isMissingEvent: () => false,
    },
  );

  assert.deepEqual(result, {
    ok: false,
    status: "retired_identity_load_failed",
  });
  assert.deepEqual(google.calls, []);
});

test("reconciliation persistence failures propagate the exact ambiguous event id", async () => {
  const google = client();
  google.createEvent = async (eventInput, eventId) => {
    google.calls.push(["create", eventId, eventInput]);
    throw new Error("provider transport failed");
  };

  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 1 },
    {
      loadProjection: async () => ({
        eventInput: input("The Blue Print"),
        previousEventId: null,
        payloadFingerprint: "stable",
        persistenceVersion: "v1",
      }),
      getClient: async () => google,
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => null,
      recordFailure: async () => {
        throw new Error("database unavailable");
      },
      isMissingEvent: () => false,
    },
  );

  assert.deepEqual(result, {
    ok: false,
    status: "reconciliation_persistence_failed",
    eventId: google.calls[0][1],
  });
});

test("newly observed retired ids are persisted and skipped by the next invocation", async () => {
  const projection = {
    eventInput: input("The Blue Print"),
    previousEventId: null,
    payloadFingerprint: "stable",
    persistenceVersion: "v1",
  };
  const firstClient = client();
  firstClient.createEvent = async (eventInput, eventId) => {
    firstClient.calls.push(["create", eventId, eventInput]);
    throw new GoogleCalendarRetiredEventIdError("retired");
  };
  const firstFailures = [];
  const first = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 1 },
    {
      loadProjection: async () => projection,
      loadRetiredEventIds: async () => [],
      getClient: async () => firstClient,
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => null,
      recordFailure: async (failure) => firstFailures.push(failure),
      isMissingEvent: () => false,
    },
  );
  assert.equal(first.ok, false);
  assert.equal(first.status, "event_id_allocation_failed");
  assert.equal(firstFailures[0].retiredEventIds.length, 32);

  const secondClient = client();
  secondClient.createEvent = async (eventInput, eventId) => {
    secondClient.calls.push(["create", eventId, eventInput]);
    throw new GoogleCalendarRetiredEventIdError("retired");
  };
  const secondFailures = [];
  await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 1 },
    {
      loadProjection: async () => projection,
      loadRetiredEventIds: async () => firstFailures[0].retiredEventIds,
      getClient: async () => secondClient,
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => null,
      recordFailure: async (failure) => secondFailures.push(failure),
      isMissingEvent: () => false,
    },
  );

  const firstIds = new Set(firstClient.calls.map(([, eventId]) => eventId));
  const secondIds = secondClient.calls.map(([, eventId]) => eventId);
  assert.equal(secondIds.length, 32);
  assert.equal(secondIds.some((eventId) => firstIds.has(eventId)), false);
  assert.equal(secondFailures[0].retiredEventIds.length, 64);
});

test("retired ids observed before a successful create are durably recorded", async () => {
  const google = client();
  let createAttempts = 0;
  google.createEvent = async (eventInput, eventId) => {
    google.calls.push(["create", eventId, eventInput]);
    createAttempts += 1;
    if (createAttempts <= 2) {
      throw new GoogleCalendarRetiredEventIdError("retired");
    }
    return { id: eventId, htmlLink: `https://calendar.test/${eventId}` };
  };
  const recordedRetiredIds = [];

  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 1 },
    {
      loadProjection: async () => ({
        eventInput: input("The Blue Print"),
        previousEventId: null,
        payloadFingerprint: "stable",
        persistenceVersion: "v1",
      }),
      loadRetiredEventIds: async () => [],
      getClient: async () => google,
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => ({
        eventId: google.calls.at(-1)[1],
        payloadFingerprint: "stable",
      }),
      recordFailure: async () => {},
      recordRetiredEventIds: async (eventIds) => {
        recordedRetiredIds.push(...eventIds);
      },
      isMissingEvent: () => false,
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "created");
  assert.equal(recordedRetiredIds.length, 2);
  assert.deepEqual(
    recordedRetiredIds,
    google.calls.slice(0, 2).map(([, eventId]) => eventId),
  );
});

test("compensated event ids remain durable across sync invocations", async () => {
  const google = client();
  const projection = {
    eventInput: input("The Blue Print"),
    previousEventId: null,
    payloadFingerprint: "stable",
    persistenceVersion: "v1",
  };
  const failures = [];
  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 3 },
    {
      loadProjection: async () => projection,
      loadRetiredEventIds: async () => [],
      getClient: async () => google,
      persistCreatedEvent: async () => "not_linked",
      loadCurrentState: async () => null,
      recordFailure: async (failure) => failures.push(failure),
      isMissingEvent: () => false,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "linkage_failed");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].retiredEventIds.length, 3);
  assert.equal(new Set(failures[0].retiredEventIds).size, 3);
});

test("an expected remote event with no client fails and is recorded", async () => {
  const failures = [];
  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 1 },
    {
      loadProjection: async () => ({
        eventInput: input("The Blue Print"),
        previousEventId: "existing-event",
        payloadFingerprint: "stable",
        persistenceVersion: "v1",
      }),
      getClient: async () => null,
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => ({
        eventId: "existing-event",
        payloadFingerprint: "stable",
      }),
      recordFailure: async (failure) => failures.push(failure),
      isMissingEvent: () => false,
    },
  );

  assert.deepEqual(result, {
    ok: false,
    status: "client_unavailable",
    eventId: "existing-event",
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].eventId, "existing-event");
});

test("an unresolved durable event identity with no local link and no client fails closed", async () => {
  const failures = [];
  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 1 },
    {
      loadProjection: async () => ({
        eventInput: input("The Blue Print"),
        previousEventId: null,
        payloadFingerprint: "stable",
        persistenceVersion: "v1",
      }),
      loadUnresolvedEventIds: async () => ["ambiguous-event"],
      getClient: async () => null,
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => ({
        eventId: null,
        payloadFingerprint: "stable",
      }),
      recordFailure: async (failure) => failures.push(failure),
      isMissingEvent: () => false,
    },
  );

  assert.deepEqual(result, {
    ok: false,
    status: "client_unavailable",
    eventId: "ambiguous-event",
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].eventId, "ambiguous-event");
});

test("unresolved identity lookup failures stop before projection or provider access", async () => {
  const google = client();
  let projectionLoaded = false;
  const result = await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 1 },
    {
      loadProjection: async () => {
        projectionLoaded = true;
        throw new Error("projection should not load");
      },
      loadUnresolvedEventIds: async () => {
        throw new Error("database unavailable");
      },
      getClient: async () => google,
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => null,
      recordFailure: async () => {},
      isMissingEvent: () => false,
    },
  );

  assert.deepEqual(result, {
    ok: false,
    status: "unresolved_identity_load_failed",
  });
  assert.equal(projectionLoaded, false);
  assert.deepEqual(google.calls, []);
});

test("sync failures never persist raw upstream error messages", async () => {
  const failures = [];
  await syncStoredBookingGoogleCalendarEventCore(
    { maxAttempts: 1 },
    {
      loadProjection: async () => ({
        eventInput: input("The Blue Print"),
        previousEventId: null,
        payloadFingerprint: "stable",
        persistenceVersion: "v1",
      }),
      getClient: async () => {
        throw new Error("private-provider-body token=secret");
      },
      persistCreatedEvent: async () => "linked",
      loadCurrentState: async () => null,
      recordFailure: async (failure) => failures.push(failure),
      isMissingEvent: () => false,
    },
  );

  assert.equal(failures.length, 1);
  assert.equal(failures[0].message, "Google Calendar synchronization failed");
  assert.doesNotMatch(failures[0].message, /private-provider-body|secret/);
});

test("cancellation cleanup includes every durable unresolved event id", () => {
  assert.deepEqual(
    calendarCleanupCandidateIds("linked-event", [
      { payload: { event_id: "ambiguous-event" } },
      { payload: { event_id: "linked-event" } },
      { payload: { event_id: "  ambiguous-event  " } },
      { payload: { event_id: null } },
      { payload: "malformed" },
    ]),
    ["linked-event", "ambiguous-event"],
  );
  assert.deepEqual(
    calendarCleanupCandidateIds(null, [
      { payload: { event_id: "orphan-without-booking-link" } },
    ], [
      { provider_external_id: "job-recorded-event" },
      { provider_external_id: " orphan-without-booking-link " },
      { provider_external_id: null },
    ]),
    ["orphan-without-booking-link", "job-recorded-event"],
  );
});

test("retired event ids are recovered from bounded reconciliation payloads", () => {
  assert.deepEqual(
    calendarRetiredEventIds([
      {
        payload: {
          status: "linkage_failed",
          event_id: "retired-one",
          retired_event_ids: ["retired-one", "retired-two", null],
        },
      },
      { payload: { status: "linkage_ambiguous", event_id: "active-event" } },
      { payload: { retired_event_ids: "malformed" } },
    ]),
    ["retired-one", "retired-two"],
  );
});
