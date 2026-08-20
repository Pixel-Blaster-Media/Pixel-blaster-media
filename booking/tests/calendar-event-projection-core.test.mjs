import assert from "node:assert/strict";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

let buildStoredBookingGoogleCalendarEventInput;
let storedBookingCalendarPayloadFingerprint;
try {
  const imported = await tsImport(
    "../lib/booking/calendar-event-projection-core.ts",
    import.meta.url,
  );
  ({
    buildStoredBookingGoogleCalendarEventInput,
    storedBookingCalendarPayloadFingerprint,
  } = imported.default);
} catch {
  // RED: the canonical stored-booking projection does not exist yet.
}

const booking = {
  id: "22222222-2222-4222-8222-222222222222",
  organization_id: "11111111-1111-4111-8111-111111111111",
  status: "confirmed",
  scheduled_at: "2026-08-26T15:00:00.000Z",
  scheduled_ends_at: "2026-08-26T16:50:00.000Z",
  services: ["blue_print"],
  add_ons: ["aerial_add_on"],
  square_footage: 2500,
  unit_number: "4B",
  is_vacant: "vacant",
  include_basement: true,
  client_notes: "Photograph the detached garage.",
  suppress_realtor_notifications: false,
  google_calendar_event_id: "existing-event",
  updated_at: "2026-08-18T18:00:00.000Z",
  properties: {
    street_address: "4854 Haldimand Road 20",
    city: "Dunnville",
    postal_code: "N1A 2W3",
  },
  profiles: {
    email: "cindy@example.com",
    full_name: "Cindy Cloutier",
    phone: "555-0100",
    brokerage: "Example Realty",
  },
};

const items = [
  { name: "The Blue Print", kind: "bundle" },
  { name: "Aerial Add-on", kind: "addon" },
];

test("canonical stored-booking projection preserves every public event field", () => {
  assert.equal(typeof buildStoredBookingGoogleCalendarEventInput, "function");
  const input = buildStoredBookingGoogleCalendarEventInput({ booking, items });

  assert.equal(
    input.summary,
    "Cindy Cloutier - The Blue Print, Aerial Add-on - 4854 Haldimand Road 20, Unit 4B",
  );
  assert.equal(
    input.location,
    "4854 Haldimand Road 20, Unit 4B, Dunnville, N1A 2W3",
  );
  assert.match(input.description, /^Realtor: Cindy Cloutier$/m);
  assert.match(input.description, /^Brokerage: Example Realty$/m);
  assert.match(input.description, /^Services: The Blue Print$/m);
  assert.match(input.description, /^Add-ons: Aerial Add-on$/m);
  assert.match(input.description, /^Size: ~2500 sqft$/m);
  assert.match(input.description, /^Occupancy: Vacant$/m);
  assert.match(input.description, /^Basement: include$/m);
  assert.match(input.description, /^Notes:\nPhotograph the detached garage\.$/m);
  assert.equal(input.attendeeEmail, "cindy@example.com");
  assert.equal(input.attendeeName, "Cindy Cloutier");
  assert.equal(input.clearAttendees, false);
  assert.equal(input.bookingId, booking.id);
  assert.equal(input.organizationId, booking.organization_id);
});

test("canonical projection explicitly clears attendees for quiet bookings", () => {
  const input = buildStoredBookingGoogleCalendarEventInput({
    booking: {
      ...booking,
      suppress_realtor_notifications: true,
    },
    items,
  });
  assert.equal("attendeeEmail" in input, false);
  assert.equal("attendeeName" in input, false);
  assert.equal(input.clearAttendees, true);
});

test("payload fingerprint changes for every Calendar-visible field but not linkage", () => {
  assert.equal(typeof storedBookingCalendarPayloadFingerprint, "function");
  const original = storedBookingCalendarPayloadFingerprint(booking, items);
  assert.equal(
    original,
    storedBookingCalendarPayloadFingerprint(
      {
        ...booking,
        google_calendar_event_id: "replacement-event",
        updated_at: "2026-08-18T18:01:00.000Z",
      },
      items,
    ),
  );

  for (const changed of [
    { ...booking, add_ons: ["site_plan"] },
    { ...booking, unit_number: "5C" },
    { ...booking, square_footage: 3000 },
    { ...booking, is_vacant: "occupied" },
    { ...booking, include_basement: false },
    { ...booking, suppress_realtor_notifications: true },
    { ...booking, client_notes: "New note" },
    { ...booking, profiles: { ...booking.profiles, brokerage: "New Brokerage" } },
    { ...booking, properties: { ...booking.properties, city: "Hamilton" } },
  ]) {
    assert.notEqual(
      storedBookingCalendarPayloadFingerprint(changed, items),
      original,
    );
  }

  assert.notEqual(
    storedBookingCalendarPayloadFingerprint(booking, [
      { name: "Historical Blue Print", kind: "bundle" },
      items[1],
    ]),
    original,
  );
  assert.notEqual(
    storedBookingCalendarPayloadFingerprint(booking, [
      { name: "The Blue Print", kind: "a_la_carte" },
      items[1],
    ]),
    original,
  );
});
