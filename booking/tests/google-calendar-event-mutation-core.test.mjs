import assert from "node:assert/strict";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

let bookingGoogleCalendarEventId;
let buildGoogleCalendarEventBody;
let googleCalendarSendUpdatesMode;
let insertGoogleCalendarEvent;
let updateGoogleCalendarEvent;
let deleteGoogleCalendarEventStrict;
let GoogleCalendarIdentityCollisionError;
let GoogleCalendarRetiredEventIdError;
try {
  const imported = await tsImport(
    "../lib/integrations/google-calendar/event-mutation-core.ts",
    import.meta.url,
  );
  ({
    bookingGoogleCalendarEventId,
    buildGoogleCalendarEventBody,
    googleCalendarSendUpdatesMode,
    insertGoogleCalendarEvent,
    updateGoogleCalendarEvent,
    deleteGoogleCalendarEventStrict,
    GoogleCalendarIdentityCollisionError,
    GoogleCalendarRetiredEventIdError,
  } = imported.default);
} catch {
  // RED: the production mutation core has not been extracted yet.
}

const bookingInput = {
  bookingId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  summary: "Realtor - The Blue Print, Aerial Add-on - 1 Main Street",
  description: "Services: The Blue Print\nAdd-ons: Aerial Add-on\n",
  location: "1 Main Street",
  startISO: "2026-08-26T15:00:00.000Z",
  endISO: "2026-08-26T16:50:00.000Z",
  clearAttendees: true,
};

function response(status, body = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return body == null ? "" : JSON.stringify(body);
    },
  };
}

function fetchSequence(sequence) {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    const next = sequence.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("Unexpected fetch");
    return next;
  };
  return { calls, fetchImpl };
}

test("booking-derived event ids are stable, generation-aware base32hex values", () => {
  assert.equal(typeof bookingGoogleCalendarEventId, "function");
  const initial = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const same = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const replacement = bookingGoogleCalendarEventId(
    bookingInput.bookingId,
    "deleted-google-id",
    0,
  );
  const nextAttempt = bookingGoogleCalendarEventId(
    bookingInput.bookingId,
    "deleted-google-id",
    1,
  );

  assert.equal(initial, same);
  assert.notEqual(initial, replacement);
  assert.notEqual(replacement, nextAttempt);
  for (const id of [initial, replacement, nextAttempt]) {
    assert.match(id, /^[a-v0-9]{5,1024}$/);
  }
});

test("quiet booking bodies explicitly clear attendees and carry private ownership", () => {
  assert.equal(typeof buildGoogleCalendarEventBody, "function");
  assert.deepEqual(buildGoogleCalendarEventBody(bookingInput), {
    summary: bookingInput.summary,
    description: bookingInput.description,
    location: bookingInput.location,
    start: { dateTime: bookingInput.startISO },
    end: { dateTime: bookingInput.endISO },
    attendees: [],
    extendedProperties: {
      private: {
        pbm_booking_id: bookingInput.bookingId,
        pbm_organization_id: bookingInput.organizationId,
      },
    },
  });
  assert.equal(googleCalendarSendUpdatesMode(bookingInput), "none");

  const invited = {
    ...bookingInput,
    clearAttendees: false,
    attendeeEmail: "realtor@example.com",
    attendeeName: "Realtor Name",
  };
  assert.deepEqual(buildGoogleCalendarEventBody(invited).attendees, [
    { email: "realtor@example.com", displayName: "Realtor Name" },
  ]);
  assert.equal(googleCalendarSendUpdatesMode(invited), "all");
});

test("idempotent insert repairs the same owned event after a 409", async () => {
  assert.equal(typeof insertGoogleCalendarEvent, "function");
  const eventId = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const { calls, fetchImpl } = fetchSequence([
    response(409, { error: "already exists" }),
    response(200, {
      id: eventId,
      htmlLink: "https://calendar.test/existing",
      status: "confirmed",
      extendedProperties: {
        private: {
          pbm_booking_id: bookingInput.bookingId,
          pbm_organization_id: bookingInput.organizationId,
        },
      },
    }),
    response(200, {
      id: eventId,
      htmlLink: "https://calendar.test/existing",
    }),
  ]);

  const event = await insertGoogleCalendarEvent({
    fetchImpl,
    accessToken: "token",
    calendarId: "primary",
    input: bookingInput,
    eventId,
  });

  assert.deepEqual(event, {
    id: eventId,
    htmlLink: "https://calendar.test/existing",
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0][1].method, "POST");
  assert.equal(JSON.parse(calls[0][1].body).id, eventId);
  assert.equal(calls[1][1].method, "GET");
  assert.equal(calls[2][1].method, "PATCH");
  assert.ok(calls.every((call) => call[1].signal instanceof AbortSignal));
  assert.deepEqual(
    JSON.parse(calls[2][1].body),
    buildGoogleCalendarEventBody(bookingInput),
  );
});

test("insert rejects identity collisions and advances past retired ids", async () => {
  const eventId = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const collision = fetchSequence([
    response(409),
    response(200, {
      id: eventId,
      htmlLink: "https://calendar.test/wrong",
      status: "confirmed",
      extendedProperties: {
        private: {
          pbm_booking_id: "33333333-3333-4333-8333-333333333333",
          pbm_organization_id: bookingInput.organizationId,
        },
      },
    }),
  ]);
  await assert.rejects(
    insertGoogleCalendarEvent({
      fetchImpl: collision.fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      input: bookingInput,
      eventId,
    }),
    /identity/i,
  );

  const retired = fetchSequence([
    response(409),
    response(200, {
      id: eventId,
      htmlLink: "https://calendar.test/deleted",
      status: "cancelled",
      extendedProperties: {
        private: {
          pbm_booking_id: bookingInput.bookingId,
          pbm_organization_id: bookingInput.organizationId,
        },
      },
    }),
  ]);
  await assert.rejects(
    insertGoogleCalendarEvent({
      fetchImpl: retired.fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      input: bookingInput,
      eventId,
    }),
    (error) => error instanceof GoogleCalendarRetiredEventIdError,
  );

  const unverifiedMissing = fetchSequence([response(409), response(404)]);
  await assert.rejects(
    insertGoogleCalendarEvent({
      fetchImpl: unverifiedMissing.fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      input: bookingInput,
      eventId,
    }),
    (error) =>
      error?.status === 404 && error?.reason === "identity_unverified_missing",
  );
  assert.deepEqual(
    unverifiedMissing.calls.map((call) => call[1].method),
    ["POST", "GET"],
  );

  for (const payload of [
    {
      id: "different-event",
      status: "cancelled",
      extendedProperties: {
        private: {
          pbm_booking_id: bookingInput.bookingId,
          pbm_organization_id: bookingInput.organizationId,
        },
      },
    },
    {
      id: eventId,
      status: "cancelled",
      extendedProperties: {
        private: {
          pbm_booking_id: "33333333-3333-4333-8333-333333333333",
          pbm_organization_id: bookingInput.organizationId,
        },
      },
    },
  ]) {
    const invalidCancelled = fetchSequence([
      response(409),
      response(200, payload),
    ]);
    await assert.rejects(
      insertGoogleCalendarEvent({
        fetchImpl: invalidCancelled.fetchImpl,
        accessToken: "token",
        calendarId: "primary",
        input: bookingInput,
        eventId,
      }),
      (error) => error instanceof GoogleCalendarIdentityCollisionError,
    );
  }
});

test("deterministic insert rejects an unexpected provider response id", async () => {
  const eventId = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const { fetchImpl } = fetchSequence([
    response(200, {
      id: "different-event",
      htmlLink: "https://calendar.test/different-event",
    }),
  ]);

  await assert.rejects(
    insertGoogleCalendarEvent({
      fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      eventId,
      input: bookingInput,
    }),
    (error) => error instanceof GoogleCalendarIdentityCollisionError,
  );
});

test("notifying inserts serialize the attendee with provider updates enabled", async () => {
  const invited = {
    ...bookingInput,
    clearAttendees: false,
    attendeeEmail: "realtor@example.com",
    attendeeName: "Realtor Name",
  };
  const eventId = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const created = fetchSequence([
    response(200, {
      id: eventId,
      htmlLink: "https://calendar.test/invited",
    }),
  ]);

  await insertGoogleCalendarEvent({
    fetchImpl: created.fetchImpl,
    accessToken: "token",
    calendarId: "primary",
    eventId,
    input: invited,
  });

  assert.match(String(created.calls[0][0]), /sendUpdates=all$/);
  assert.deepEqual(JSON.parse(created.calls[0][1].body).attendees, [
    { email: "realtor@example.com", displayName: "Realtor Name" },
  ]);
  assert.ok(created.calls[0][1].signal instanceof AbortSignal);
});

test("provider updates send the complete quiet payload and clear stale attendees", async () => {
  assert.equal(typeof updateGoogleCalendarEvent, "function");
  const eventId = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const { calls, fetchImpl } = fetchSequence([
    response(200, {
      id: eventId,
      extendedProperties: {
        private: {
          pbm_booking_id: bookingInput.bookingId,
          pbm_organization_id: bookingInput.organizationId,
        },
      },
    }),
    response(200, {
      id: eventId,
      htmlLink: "https://calendar.test/updated",
    }),
  ]);

  const event = await updateGoogleCalendarEvent({
    fetchImpl,
    accessToken: "token",
    calendarId: "primary",
    eventId,
    input: bookingInput,
  });

  assert.deepEqual(event, {
    id: eventId,
    htmlLink: "https://calendar.test/updated",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[1][1].method, "PATCH");
  assert.ok(calls.every((call) => call[1].signal instanceof AbortSignal));
  assert.match(String(calls[1][0]), /sendUpdates=none$/);
  assert.deepEqual(
    JSON.parse(calls[1][1].body),
    buildGoogleCalendarEventBody(bookingInput),
  );
});

test("provider updates reject marked cross-booking event collisions before PATCH", async () => {
  const eventId = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const { calls, fetchImpl } = fetchSequence([
    response(200, {
      id: eventId,
      extendedProperties: {
        private: {
          pbm_booking_id: "33333333-3333-4333-8333-333333333333",
          pbm_organization_id: bookingInput.organizationId,
        },
      },
    }),
  ]);

  await assert.rejects(
    updateGoogleCalendarEvent({
      fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      eventId,
      input: bookingInput,
    }),
    (error) => error instanceof GoogleCalendarIdentityCollisionError,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].method, "GET");
});

test("provider updates reject empty or partial ownership markers before PATCH", async () => {
  const eventId = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  for (const ownership of [
    { pbm_booking_id: "", pbm_organization_id: "" },
    { pbm_booking_id: "", pbm_organization_id: bookingInput.organizationId },
    { pbm_booking_id: bookingInput.bookingId },
    { pbm_organization_id: bookingInput.organizationId },
  ]) {
    const partial = fetchSequence([
      response(200, {
        id: eventId,
        extendedProperties: { private: ownership },
      }),
    ]);
    await assert.rejects(
      updateGoogleCalendarEvent({
        fetchImpl: partial.fetchImpl,
        accessToken: "token",
        calendarId: "primary",
        eventId,
        input: bookingInput,
      }),
      (error) => error instanceof GoogleCalendarIdentityCollisionError,
    );
    assert.equal(partial.calls.length, 1);
  }
});

test("provider updates treat an ownership-verified cancelled event as missing", async () => {
  const eventId = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const cancelled = fetchSequence([
    response(200, {
      id: eventId,
      status: "cancelled",
      extendedProperties: {
        private: {
          pbm_booking_id: bookingInput.bookingId,
          pbm_organization_id: bookingInput.organizationId,
        },
      },
    }),
  ]);

  await assert.rejects(
    updateGoogleCalendarEvent({
      fetchImpl: cancelled.fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      eventId,
      input: bookingInput,
    }),
    (error) => error?.status === 410,
  );
  assert.equal(cancelled.calls.length, 1);
  assert.equal(cancelled.calls[0][1].method, "GET");
});

test("provider updates do not recreate after an ownership-unverified GET 404", async () => {
  const eventId = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const missing = fetchSequence([response(404)]);

  await assert.rejects(
    updateGoogleCalendarEvent({
      fetchImpl: missing.fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      eventId,
      input: bookingInput,
    }),
    (error) =>
      error?.status === 404 && error?.reason === "identity_unverified_missing",
  );
  assert.equal(missing.calls.length, 1);
  assert.equal(missing.calls[0][1].method, "GET");
});

test("malformed private ownership metadata is never adopted or deleted as legacy", async () => {
  const malformedPayloads = [
    { id: "legacy-event", extendedProperties: null },
    { id: "legacy-event", extendedProperties: "invalid" },
    { id: "legacy-event", extendedProperties: [] },
    ...[null, "invalid", [], 42].map((privateValue) => ({
      id: "legacy-event",
      extendedProperties: { private: privateValue },
    })),
  ];
  for (const malformedPayload of malformedPayloads) {
    const updateAttempt = fetchSequence([
      response(200, malformedPayload),
    ]);
    await assert.rejects(
      updateGoogleCalendarEvent({
        fetchImpl: updateAttempt.fetchImpl,
        accessToken: "token",
        calendarId: "primary",
        eventId: "legacy-event",
        input: bookingInput,
      }),
      (error) => error instanceof GoogleCalendarIdentityCollisionError,
    );
    assert.equal(updateAttempt.calls.length, 1);

    const deleteAttempt = fetchSequence([
      response(200, malformedPayload),
    ]);
    await assert.rejects(
      deleteGoogleCalendarEventStrict({
        fetchImpl: deleteAttempt.fetchImpl,
        accessToken: "token",
        calendarId: "primary",
        eventId: "legacy-event",
        bookingId: bookingInput.bookingId,
        organizationId: bookingInput.organizationId,
        allowMarkerlessLegacy: true,
      }),
      (error) => error instanceof GoogleCalendarIdentityCollisionError,
    );
    assert.equal(deleteAttempt.calls.length, 1);
  }
});

test("provider updates safely adopt legacy linked events without ownership markers", async () => {
  const { calls, fetchImpl } = fetchSequence([
    response(200, { id: "legacy-event" }),
    response(200, {
      id: "legacy-event",
      htmlLink: "https://calendar.test/legacy-event",
    }),
  ]);

  await updateGoogleCalendarEvent({
    fetchImpl,
    accessToken: "token",
    calendarId: "primary",
    eventId: "legacy-event",
    input: bookingInput,
  });
  assert.deepEqual(calls.map((call) => call[1].method), ["GET", "PATCH"]);
  assert.deepEqual(
    JSON.parse(calls[1][1].body).extendedProperties.private,
    {
      pbm_booking_id: bookingInput.bookingId,
      pbm_organization_id: bookingInput.organizationId,
    },
  );
});

test("provider updates reject an unexpected PATCH response id", async () => {
  const eventId = bookingGoogleCalendarEventId(bookingInput.bookingId, null, 0);
  const { fetchImpl } = fetchSequence([
    response(200, {
      id: eventId,
      extendedProperties: {
        private: {
          pbm_booking_id: bookingInput.bookingId,
          pbm_organization_id: bookingInput.organizationId,
        },
      },
    }),
    response(200, {
      id: "different-event",
      htmlLink: "https://calendar.test/different-event",
    }),
  ]);

  await assert.rejects(
    updateGoogleCalendarEvent({
      fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      eventId,
      input: bookingInput,
    }),
    (error) => error instanceof GoogleCalendarIdentityCollisionError,
  );
});

test("strict delete verifies ownership, accepts gone events, and reports failures", async () => {
  assert.equal(typeof deleteGoogleCalendarEventStrict, "function");
  const ownership = {
    bookingId: bookingInput.bookingId,
    organizationId: bookingInput.organizationId,
  };
  const ownedPayload = {
    id: "event-id",
    extendedProperties: {
      private: {
        pbm_booking_id: bookingInput.bookingId,
        pbm_organization_id: bookingInput.organizationId,
      },
    },
  };

  const deleted = fetchSequence([response(200, ownedPayload), response(204)]);
  await deleteGoogleCalendarEventStrict({
    fetchImpl: deleted.fetchImpl,
    accessToken: "token",
    calendarId: "primary",
    eventId: "event-id",
    ...ownership,
  });
  assert.deepEqual(deleted.calls.map((call) => call[1].method), ["GET", "DELETE"]);
  assert.ok(deleted.calls.every((call) => call[1].signal instanceof AbortSignal));

  const gone = fetchSequence([response(410)]);
  await deleteGoogleCalendarEventStrict({
    fetchImpl: gone.fetchImpl,
    accessToken: "token",
    calendarId: "primary",
    eventId: "event-id",
    ...ownership,
  });
  assert.equal(gone.calls.length, 1);
  assert.equal(gone.calls[0][1].method, "GET");

  const unverifiedMissing = fetchSequence([response(404)]);
  await assert.rejects(
    deleteGoogleCalendarEventStrict({
      fetchImpl: unverifiedMissing.fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      eventId: "event-id",
      ...ownership,
    }),
    (error) =>
      error?.status === 404 && error?.reason === "identity_unverified_missing",
  );
  assert.equal(unverifiedMissing.calls.length, 1);
  assert.equal(unverifiedMissing.calls[0][1].method, "GET");

  const denied = fetchSequence([
    response(200, ownedPayload),
    response(403, { error: "private-provider-detail" }),
  ]);
  await assert.rejects(
    deleteGoogleCalendarEventStrict({
      fetchImpl: denied.fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      eventId: "event-id",
      ...ownership,
    }),
    (error) => {
      assert.equal(error?.status, 403);
      assert.doesNotMatch(error?.message ?? "", /private-provider-detail/);
      return true;
    },
  );

  const offline = fetchSequence([response(200, ownedPayload), new Error("offline")]);
  await assert.rejects(
    deleteGoogleCalendarEventStrict({
      fetchImpl: offline.fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      eventId: "event-id",
      ...ownership,
    }),
    /offline/,
  );
});

test("strict delete rejects marked cross-booking collisions before DELETE", async () => {
  const collision = fetchSequence([
    response(200, {
      id: "event-id",
      extendedProperties: {
        private: {
          pbm_booking_id: "33333333-3333-4333-8333-333333333333",
          pbm_organization_id: bookingInput.organizationId,
        },
      },
    }),
  ]);
  await assert.rejects(
    deleteGoogleCalendarEventStrict({
      fetchImpl: collision.fetchImpl,
      accessToken: "token",
      calendarId: "primary",
      eventId: "event-id",
      bookingId: bookingInput.bookingId,
      organizationId: bookingInput.organizationId,
    }),
    (error) => error instanceof GoogleCalendarIdentityCollisionError,
  );
  assert.equal(collision.calls.length, 1);
  assert.equal(collision.calls[0][1].method, "GET");
});

test("strict delete requires complete ownership unless a stored legacy link authorizes adoption", async () => {
  const ownership = {
    bookingId: bookingInput.bookingId,
    organizationId: bookingInput.organizationId,
  };
  for (const privateMarkers of [
    undefined,
    { pbm_booking_id: "", pbm_organization_id: bookingInput.organizationId },
    { pbm_booking_id: bookingInput.bookingId },
  ]) {
    const unowned = fetchSequence([
      response(200, {
        id: "legacy-event",
        ...(privateMarkers
          ? { extendedProperties: { private: privateMarkers } }
          : {}),
      }),
    ]);
    await assert.rejects(
      deleteGoogleCalendarEventStrict({
        fetchImpl: unowned.fetchImpl,
        accessToken: "token",
        calendarId: "primary",
        eventId: "legacy-event",
        ...ownership,
      }),
      (error) => error instanceof GoogleCalendarIdentityCollisionError,
    );
    assert.equal(unowned.calls.length, 1);
  }

  const adopted = fetchSequence([
    response(200, { id: "legacy-event" }),
    response(204),
  ]);
  await deleteGoogleCalendarEventStrict({
    fetchImpl: adopted.fetchImpl,
    accessToken: "token",
    calendarId: "primary",
    eventId: "legacy-event",
    ...ownership,
    allowMarkerlessLegacy: true,
  });
  assert.deepEqual(
    adopted.calls.map((call) => call[1].method),
    ["GET", "DELETE"],
  );
});
