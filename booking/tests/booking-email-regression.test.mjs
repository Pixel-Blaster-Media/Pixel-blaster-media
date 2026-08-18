import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const templates = await fs.readFile(
  path.join(root, "lib/email/templates.ts"),
  "utf8",
);
const dispatcher = await fs.readFile(
  path.join(root, "lib/integrations/dispatcher.ts"),
  "utf8",
);
const bookingActions = await fs.readFile(
  path.join(root, "app/admin/bookings/[id]/actions.ts"),
  "utf8",
);
const reminderRoute = await fs.readFile(
  path.join(root, "app/api/cron/reminders/route.ts"),
  "utf8",
);
const calendarActions = await fs.readFile(
  path.join(root, "app/admin/calendar/actions.ts"),
  "utf8",
);
const googleCalendarClient = await fs.readFile(
  path.join(root, "lib/integrations/google-calendar/client.ts"),
  "utf8",
);
const icsRoute = await fs.readFile(
  path.join(root, "app/book/success/ics/route.ts"),
  "utf8",
);

test("realtor confirmation email has fast booking and calendar actions", () => {
  assert.match(templates, /Change or cancel booking/);
  assert.match(templates, /label: "Add to Google Calendar"/);
  assert.match(templates, /label: "Add to iCal \/ Outlook"/);
  assert.match(templates, /Open client portal/);
  assert.match(templates, /View or pay invoice/);
  assert.match(templates, /Your notes/);
  assert.match(templates, /What changed/);
  assert.match(templates, /totalPriceCents/);
  assert.match(dispatcher, /shootConfirmedEmail\(\{/);
  assert.match(dispatcher, /bookingIcsCalendarLink\(appUrl/);
  assert.match(dispatcher, /notes: payload\.booking\.client_notes/);
  assert.match(dispatcher, /totalPriceCents: bookingTotalPriceCents\(payload\)/);
});

test("staff booking email links to the job, directions, calendar, and realtor", () => {
  assert.match(templates, /export function newBookingStaffEmail/);
  assert.match(templates, /Open booking/);
  assert.match(templates, /Get directions/);
  assert.match(templates, /Open booking calendar/);
  assert.match(templates, /href="mailto:/);
  assert.match(templates, /href="tel:/);
  assert.match(templates, /href="sms:/);
  assert.match(templates, /Add to another Google Calendar/);
  assert.match(templates, /Download for iCal \/ Outlook/);
  assert.match(dispatcher, /newBookingStaffEmail\(\{/);
  assert.match(dispatcher, /googleCalendarLink,/);
  assert.match(dispatcher, /calendarDownloadLink,/);
});

test("manual confirmation resends use the same complete template", () => {
  assert.match(bookingActions, /bookingGoogleCalendarLink\(\{/);
  assert.match(bookingActions, /bookingIcsCalendarLink\(appUrl/);
  assert.match(bookingActions, /manageLink,/);
  assert.match(bookingActions, /invoiceLink: booking\.quickbooks_invoice_url/);
  assert.match(bookingActions, /addOns,/);
  assert.match(bookingActions, /changes: args\.changes/);
  assert.match(bookingActions, /client_notes/);
  assert.match(bookingActions, /unit_price_cents/);
});

test("booking updates explain exactly what changed and notify by default", () => {
  assert.match(bookingActions, /Time changed from/);
  assert.match(bookingActions, /Package changed from/);
  assert.match(bookingActions, /Add-ons changed from/);
  assert.match(bookingActions, /Realtor notes updated/);
  assert.match(bookingActions, /sendShootCompleteEmailBestEffort/);
});

test("day-before reminders carry practical property and access context", () => {
  assert.match(reminderRoute, /client_notes/);
  assert.match(reminderRoute, /square_footage/);
  assert.match(reminderRoute, /include_basement/);
  assert.match(reminderRoute, /directionsLink/);
  assert.match(templates, /Before we arrive/);
  assert.match(templates, /Your notes/);
  assert.match(templates, /Get directions/);
});

test("calendar updates remain in place and portable events keep one identity", () => {
  assert.match(calendarActions, /updateEventTime\(/);
  assert.match(bookingActions, /updateEvent\(args\.previousEventId/);
  assert.match(googleCalendarClient, /events\.patch/);
  assert.match(googleCalendarClient, /sendUpdates=all/);
  assert.match(icsRoute, /requestedUid/);
  assert.match(icsRoute, /Notes:/);
});

test("shoot completion sends next steps before final media delivery", () => {
  assert.match(templates, /export function shootCompleteEmail/);
  assert.match(templates, /That’s a wrap/);
  assert.match(templates, /moving into editing/);
  assert.match(bookingActions, /next === "shot"/);
  assert.match(bookingActions, /kind: "shoot_complete"/);
});
