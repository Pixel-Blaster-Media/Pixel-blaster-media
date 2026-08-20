import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  pageSource,
  formSource,
  actionSource,
  calendarPageSource,
  calendarViewSource,
  calendarActionsSource,
  fanoutSource,
] = await Promise.all([
  read("app/admin/bookings/[id]/page.tsx"),
  read("app/admin/bookings/[id]/EditBookingForm.tsx"),
  read("app/admin/bookings/[id]/actions.ts"),
  read("app/admin/calendar/page.tsx"),
  read("app/admin/calendar/CalendarWeekView.tsx"),
  read("app/admin/calendar/actions.ts"),
  read("lib/booking/realtor-calendar-fanout.ts"),
]);

test("admin booking edits retain selected inactive historical catalog items", () => {
  assert.match(pageSource, /getFullCatalog\(\{ organizationId: admin\.organizationId \}\)/);
  assert.match(
    pageSource,
    /item\.active \|\| selectedCatalogItemIdSet\.has\(item\.id\)/,
  );
  assert.match(formSource, /inactive — retained from booking/);
  const selectionHelper = pageSource.slice(
    pageSource.indexOf("function selectedCatalogIdsForBooking"),
    pageSource.indexOf("function buildListingSlug"),
  );
  assert.match(selectionHelper, /booking\.services[\s\S]*booking\.add_ons/);
  assert.doesNotMatch(selectionHelper, /lineItems|booking_line_items/);
  assert.match(
    actionSource,
    /updateBookingDetails[\s\S]*getFullCatalog\(\{ organizationId: admin\.organizationId \}\)[\s\S]*currentSlugs[\s\S]*!item\.active[\s\S]*cannot be newly added/,
  );
});

test("calendar quick edits preserve selected inactive items without offering new ones", () => {
  assert.match(
    calendarPageSource,
    /getFullCatalog\(\{ organizationId: admin\.organizationId \}\)/,
  );
  assert.match(calendarPageSource, /active:\s*item\.active/);
  assert.match(
    calendarViewSource,
    /catalogItems\.filter\(\(item\) => item\.active\)/,
  );
  assert.match(calendarViewSource, /!catalogItem\.active && !selected/);
  assert.match(
    actionSource,
    /updateBookingServicesFromCalendar[\s\S]*getFullCatalog\(\{ organizationId: admin\.organizationId \}\)[\s\S]*currentSlugs[\s\S]*!item\.active[\s\S]*cannot be newly added/,
  );
  const quickStart = actionSource.indexOf(
    "export async function updateBookingServicesFromCalendar",
  );
  const quickEnd = actionSource.indexOf(
    "export async function rescheduleBookingFromDetails",
    quickStart,
  );
  const quickSource = actionSource.slice(quickStart, quickEnd);
  assert.doesNotMatch(quickSource, /if \(lineItemError\) return/);
  assert.match(
    quickSource,
    /lineItemWarning[\s\S]*syncGoogleCalendarEventBestEffort[\s\S]*combineActionWarnings\([\s\S]*lineItemWarning/,
  );
});

test("admin edits avoid shared-projection drift on realtor and property changes", () => {
  const editStart = actionSource.indexOf("export async function updateBookingDetails");
  const editEnd = actionSource.indexOf("export async function updateBookingServicesFromCalendar");
  const editSource = actionSource.slice(editStart, editEnd);
  assert.ok(editStart >= 0 && editEnd > editStart);

  const bookingWrite = editSource.indexOf(".update({\n      property_id: propertyId");
  const profileWrite = editSource.indexOf('.from("profiles")');
  assert.ok(bookingWrite >= 0 && profileWrite > bookingWrite);
  assert.doesNotMatch(editSource, /if \(lineItemError\) return/);
  assert.match(
    editSource,
    /syncRealtorCalendarEventsBestEffort\([\s\S]*ownerId:\s*booking\.owner_id/,
  );
  assert.doesNotMatch(
    fanoutSource,
    /\.not\("google_calendar_event_id",\s*"is",\s*null\)/,
  );
  assert.match(
    fanoutSource,
    /\.not\("scheduled_at",\s*"is",\s*null\)[\s\S]*\.not\("scheduled_ends_at",\s*"is",\s*null\)/,
  );

  const propertyHelperStart = actionSource.indexOf(
    "async function findOrCreatePropertyForBooking",
  );
  const propertyHelperEnd = actionSource.indexOf(
    "async function syncGoogleCalendarEventBestEffort",
    propertyHelperStart,
  );
  const propertyHelper = actionSource.slice(propertyHelperStart, propertyHelperEnd);
  assert.ok(propertyHelperStart >= 0 && propertyHelperEnd > propertyHelperStart);
  assert.doesNotMatch(propertyHelper, /\.from\("properties"\)[\s\S]*\.update\(/);
  assert.match(propertyHelper, /\.eq\("street_address", args\.streetAddress\)/);
  assert.doesNotMatch(propertyHelper, /\.ilike\("street_address"/);
  assert.doesNotMatch(
    actionSource,
    /\[booking-edit\][^\n]*",\s*(?:err|error|result\.error)/,
  );
  assert.doesNotMatch(
    actionSource,
    /error:\s*result\.ok\s*\?\s*null\s*:\s*\(result\.error/,
  );
});

test("admin calendar creation defers shared profile mutation and fans out canonical sync", () => {
  const createStart = calendarActionsSource.indexOf(
    "export async function createAdminShoot",
  );
  const createEnd = calendarActionsSource.indexOf(
    "export async function rescheduleCalendarShoot",
    createStart,
  );
  const createSource = calendarActionsSource.slice(createStart, createEnd);
  const bookingInsert = createSource.indexOf('.from("bookings")\n    .insert');
  const profileUpdate = createSource.indexOf('.from("profiles")\n      .update');
  assert.ok(bookingInsert >= 0 && profileUpdate > bookingInsert);
  assert.match(
    createSource,
    /syncRealtorCalendarEventsBestEffort\([\s\S]*ownerId:\s*userId[\s\S]*excludeBookingId:\s*booking\.id/,
  );
  assert.match(
    createSource,
    /lineItemWarning[\s\S]*profileWarning[\s\S]*siblingCalendarWarning[\s\S]*combineWarnings\(/,
  );
});

test("admin booking warnings aggregate Calendar, invoice, and email failures", () => {
  assert.match(
    actionSource,
    /combineActionWarnings\([\s\S]*Google Calendar did not sync[\s\S]*already has an invoice[\s\S]*confirmation email was not sent/,
  );
  assert.match(
    actionSource,
    /warning: combineActionWarnings\([\s\S]*result\.warning[\s\S]*Booking rescheduled, but the confirmation email was not sent/,
  );
});
