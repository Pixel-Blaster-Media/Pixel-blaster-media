import assert from "node:assert/strict";
import test from "node:test";

import { parseBookingIntegrationPayload } from "../lib/integrations/booking-job-payload.ts";

const validPayload = {
  schema_version: 1,
  booking_id: "90000000-0000-4000-8000-000000000001",
  organization_id: "11111111-1111-4111-8111-111111111111",
  public_request_id: "80000000-0000-4000-8000-000000000001",
  app_url: "https://booking.example.com",
  organization: {
    name: "Fixture Media",
    from_name: "Fixture Media",
    reply_to_email: "support@example.com",
    admin_notification_email: "admin@example.com",
  },
  realtor: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "realtor@example.com",
    full_name: "Fixture Realtor",
    phone: null,
    brokerage: null,
    delivery_cc_emails: ["assistant@example.com"],
  },
  property: {
    street_address: "10 Atomic Street",
    city: "Toronto",
    postal_code: "M1M 1M1",
    unit_number: null,
  },
  booking: {
    scheduled_at: "2030-01-10T15:00:00.000Z",
    scheduled_ends_at: "2030-01-10T17:00:00.000Z",
    square_footage: 2500,
    is_vacant: "vacant",
    include_basement: true,
    client_notes: "Fixture",
  },
  line_items: [{
    catalog_item_id: "10000000-0000-4000-8000-000000000001",
    name: "Photos",
    slug: "photos",
    kind: "a_la_carte",
    quantity: 1,
    unit_price_cents: 25000,
    unit_duration_minutes: 90,
  }],
};

function changed(mutator) {
  const copy = structuredClone(validPayload);
  mutator(copy);
  return copy;
}

test("accepts a complete semantically valid booking integration payload", () => {
  assert.deepEqual(parseBookingIntegrationPayload(validPayload), validPayload);
  assert.notEqual(
    parseBookingIntegrationPayload(changed((p) => {
      p.app_url = "http://localhost?preview=1";
    })),
    null,
  );
});

test("rejects malformed durable booking payloads before provider consumption", () => {
  const invalid = [
    changed((p) => { delete p.booking_id; }),
    changed((p) => { delete p.line_items[0].catalog_item_id; }),
    changed((p) => { p.organization.name = 7; }),
    changed((p) => { p.organization.from_name = { x: 1 }; }),
    changed((p) => { p.realtor.full_name = 7; }),
    changed((p) => { p.property.street_address = 7; }),
    changed((p) => { p.line_items[0].name = 7; }),
    changed((p) => { p.line_items[0].slug = true; }),
    changed((p) => { p.booking_id = "not-a-uuid"; }),
    changed((p) => { p.app_url = "javascript:alert(1)"; }),
    changed((p) => { p.app_url = "https://user:pass@example.com"; }),
    changed((p) => { p.realtor.email = "not-an-email"; }),
    changed((p) => { p.booking.scheduled_at = "not-a-date"; }),
    changed((p) => { p.booking.scheduled_at = "2030-01-01"; }),
    changed((p) => { p.booking.scheduled_at = "2030-02-30T15:00:00Z"; }),
    changed((p) => { p.booking.scheduled_at = "2030-06-30T23:59:60Z"; }),
    changed((p) => { p.booking.scheduled_ends_at = p.booking.scheduled_at; }),
    changed((p) => { p.booking.square_footage = -1; }),
    changed((p) => { p.line_items[0].quantity = 0; }),
    changed((p) => { p.line_items[0].unit_price_cents = -1; }),
    changed((p) => { p.line_items[0].unit_duration_minutes = Number.NaN; }),
    changed((p) => { p.line_items = []; }),
  ];
  for (const payload of invalid) {
    assert.equal(parseBookingIntegrationPayload(payload), null);
  }
});
