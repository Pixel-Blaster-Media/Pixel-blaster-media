import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readVendorInput, vendorEventId, vendorEventInput, vendorFingerprint } from "../lib/booking/vendor-invite-core.ts";
import { insertGoogleCalendarEvent, updateGoogleCalendarEvent, deleteGoogleCalendarEventStrict } from "../lib/integrations/google-calendar/event-mutation-core.ts";

const vendor = {
  id: "vendor-assignment-a", organization_id: "org-a", email: "vendor@example.invalid", name: "Drone Co.",
  instructions: "Meet at the side door. <No key needed>", logo_url: "https://cdn.example.invalid/logo.png",
  removed: false, calendar_connection_id: null, google_event_id: null,
};
const booking = {
  status: "confirmed", scheduled_at: "2026-12-01T15:00:00Z", scheduled_ends_at: "2026-12-01T16:00:00Z",
  unit_number: "5", properties: { street_address: "1 Example St", city: "Hamilton", province: "ON" },
  client_notes: "PRIVATE", price: 900, profile: { email: "client@example.invalid" },
};

test("optional form input normalizes a saved contact and rejects unsafe inputs", () => {
  const form = new FormData();
  assert.equal(readVendorInput(form), null);
  form.set("vendor_email", " Vendor@Example.Invalid ");
  form.set("vendor_logo_url", "https://cdn.example.invalid/logo.png");
  form.set("vendor_save_contact", "on");
  assert.deepEqual(readVendorInput(form), {
    email: vendor.email, name: "", logo_url: vendor.logo_url, instructions: "", save: true,
  });
  form.set("vendor_logo_url", "javascript:alert(1)");
  assert.throws(() => readVendorInput(form), /HTTPS/);
  form.delete("vendor_logo_url");
  form.set("vendor_email", "v@example.invalid,v2@example.invalid");
  assert.throws(() => readVendorInput(form), /valid vendor email/);
});

test("vendor create, reschedule and cancel use one isolated Calendar event and no private booking data", async () => {
  const eventId = vendorEventId(vendor.id);
  assert.match(eventId, /^pbv[0-9a-f]{64}$/);
  assert.notEqual(eventId, vendorEventId("vendor-assignment-b"));
  const calls = [];
  let event;
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method });
    if (init.method === "GET") return new Response(JSON.stringify(event), { status: 200 });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload.attendees, [{ email: vendor.email, displayName: vendor.name }]);
    assert.equal(payload.transparency, "transparent");
    assert.equal(payload.visibility, "private");
    assert.equal(payload.guestsCanInviteOthers, false);
    assert.equal(payload.guestsCanSeeOtherGuests, false);
    assert.equal(payload.location, "1 Example St, Unit 5, Hamilton, ON");
    assert.match(payload.description, /&lt;No key needed&gt;/);
    assert.doesNotMatch(init.body, /PRIVATE|client@example|logo.png|900/);
    event = { ...payload, id: eventId, htmlLink: "https://calendar.example.invalid/event" };
    return new Response(JSON.stringify(event), { status: 200 });
  };
  const args = { fetchImpl, accessToken: "test-only", calendarId: "test-calendar", eventId };
  const initial = vendorEventInput(booking, vendor);
  await insertGoogleCalendarEvent({ ...args, input: initial });
  const moved = vendorEventInput({ ...booking, scheduled_at: "2026-12-01T16:00:00Z", scheduled_ends_at: "2026-12-01T17:00:00Z" }, vendor);
  assert.notEqual(vendorFingerprint(initial), vendorFingerprint(moved));
  await updateGoogleCalendarEvent({ ...args, input: moved });
  assert.equal(event.start.dateTime, moved.startISO);
  assert.equal(vendorEventInput({ ...booking, status: "cancelled" }, vendor), null);
  assert.equal(vendorEventInput(booking, { ...vendor, removed: true }), null);
  await deleteGoogleCalendarEventStrict({ ...args, bookingId: vendor.id, organizationId: vendor.organization_id });
  assert.deepEqual(calls.map(({ method }) => method), ["POST", "GET", "PATCH", "GET", "DELETE"]);
  assert.equal(calls.filter(({ url }) => url.endsWith("sendUpdates=all")).length, 3);
});

test("vendor retry repairs the existing event after a lost create response and reschedule", async () => {
  const eventId = vendorEventId(vendor.id);
  let event;
  const calls = [];
  let patchFails = true;
  const fetchImpl = async (url, init) => {
    calls.push(init.method);
    switch (init.method) {
      case "POST":
        assert.equal(JSON.parse(init.body).id, eventId);
        if (event) return new Response(null, { status: 409 });
        event = { ...JSON.parse(init.body), htmlLink: "https://calendar.example.invalid/event" };
        throw new Error("Calendar committed the insert but its response was lost");
      case "GET":
        assert.ok(url.endsWith("/" + eventId));
        return Response.json(event);
      case "PATCH":
        assert.ok(url.endsWith("/" + eventId + "?sendUpdates=all"));
        if (patchFails) return new Response(null, { status: 503 });
        event = { ...event, ...JSON.parse(init.body) };
        return Response.json(event);
      default:
        assert.fail("Unexpected Google Calendar operation " + init.method);
    }
  };
  const args = { fetchImpl, accessToken: "test-only", calendarId: "test-calendar", eventId };
  const initial = vendorEventInput(booking, vendor);
  await assert.rejects(insertGoogleCalendarEvent({ ...args, input: initial }), /response was lost/);
  assert.equal(event.start.dateTime, initial.startISO);

  const moved = vendorEventInput({
    ...booking, scheduled_at: "2026-12-01T18:00:00Z", scheduled_ends_at: "2026-12-01T19:00:00Z",
  }, vendor);
  await assert.rejects(insertGoogleCalendarEvent({ ...args, input: moved }), /503/);
  assert.equal(event.start.dateTime, initial.startISO);

  patchFails = false;
  const recovered = await insertGoogleCalendarEvent({ ...args, input: moved });
  assert.equal(recovered.id, eventId);
  assert.equal(event.start.dateTime, moved.startISO);
  assert.equal(event.end.dateTime, moved.endISO);
  assert.equal(event.attendees[0].email, vendor.email);
  assert.deepEqual(calls, ["POST", "POST", "GET", "PATCH", "POST", "GET", "PATCH"]);
});

test("the admin forms and lifecycle service use the isolated vendor workflow", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source("../app/admin/calendar/CalendarWeekView.tsx"), /<VendorFields contacts=\{vendorContacts\}/);
  assert.match(source("../app/admin/calendar/actions.ts"), /attachVendor\(\{ organizationId: admin.organizationId, bookingId: booking.id \}/);
  assert.match(source("../app/admin/bookings/[id]/vendor-actions.ts"), /await requireAdmin\(\)/);
  assert.match(source("../lib/booking/calendar-event-service.ts"), /syncBookingVendorInvites\(args\)/);
  assert.match(source("../supabase/migrations/20261124205000_booking_vendor_invites.sql"), /foreign key \(organization_id, booking_id\) references public.bookings\(organization_id, id\)/i);
});

test("the form loads saved vendor and logo, allows one-off details, and removes fields when opting out", async () => {
  const { loadSource } = await import("./helpers/source-module.mjs");
  const React = (await import("react")).default;
  const { default: TestRenderer, act } = await import("react-test-renderer");
  const jsx = await import("react/jsx-runtime");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { default: VendorFields } = loadSource("app/admin/VendorFields.tsx", { "react/jsx-runtime": jsx, react: React });
  const contact = { email: vendor.email, name: vendor.name, logo_url: vendor.logo_url };
  let tree;
  await act(async () => { tree = TestRenderer.create(React.createElement(VendorFields, { contacts: [contact] })); });
  try {
    await act(async () => tree.root.findByType("button").props.onClick());
    await act(async () => tree.root.findByType("select").props.onChange({ target: { value: contact.email } }));
    const input = name => tree.root.findAllByType("input").find(node => node.props.name === name);
    assert.equal(input("vendor_email").props.value, contact.email);
    assert.equal(input("vendor_name").props.value, contact.name);
    assert.equal(input("vendor_logo_url").props.value, contact.logo_url);
    assert.equal(tree.root.findByType("img").props.referrerPolicy, "no-referrer");
    await act(async () => input("vendor_email").props.onChange({ target: { value: "other@example.invalid" } }));
    assert.equal(input("vendor_email").props.value, "other@example.invalid");
    const optOut = tree.root.findAllByType("button").find(button => button.children.join("").includes("Don’t invite"));
    await act(async () => optOut.props.onClick());
    assert.equal(tree.root.findAllByType("input").length, 0);
  } finally {
    await act(async () => tree.unmount());
  }
});
