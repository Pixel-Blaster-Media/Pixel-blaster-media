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

test("realtor confirmation email has fast booking and calendar actions", () => {
  assert.match(templates, /Change or cancel booking/);
  assert.match(templates, /Add to Google Calendar/);
  assert.match(templates, /Add to iCal \/ Outlook/);
  assert.match(templates, /Open client portal/);
  assert.match(templates, /View or pay invoice/);
  assert.match(dispatcher, /shootConfirmedEmail\(\{/);
  assert.match(dispatcher, /bookingIcsCalendarLink\(appUrl/);
});

test("staff booking email links to the job, directions, calendar, and realtor", () => {
  assert.match(templates, /export function newBookingStaffEmail/);
  assert.match(templates, /Open booking/);
  assert.match(templates, /Get directions/);
  assert.match(templates, /Open booking calendar/);
  assert.match(templates, /href="mailto:/);
  assert.match(templates, /href="tel:/);
  assert.match(dispatcher, /newBookingStaffEmail\(\{/);
});

test("manual confirmation resends use the same complete template", () => {
  assert.match(bookingActions, /bookingGoogleCalendarLink\(\{/);
  assert.match(bookingActions, /bookingIcsCalendarLink\(appUrl/);
  assert.match(bookingActions, /manageLink,/);
  assert.match(bookingActions, /invoiceLink: booking\.quickbooks_invoice_url/);
  assert.match(bookingActions, /addOns,/);
});
