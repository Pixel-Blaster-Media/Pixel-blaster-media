import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [
  cancelSource,
  serviceSource,
  adminActions,
  adminButton,
  manageActions,
  manageClient,
  bookingActions,
  assistantActions,
] = await Promise.all([
  read("lib/booking/cancel.ts"),
  read("lib/booking/calendar-event-service.ts"),
  read("app/admin/bookings/[id]/actions.ts"),
  read("app/admin/bookings/CancelBookingButton.tsx"),
  read("app/book/manage/[token]/actions.ts"),
  read("app/book/manage/[token]/ManageBookingClient.tsx"),
  read("app/admin/bookings/[id]/BookingActions.tsx"),
  read("app/admin/assistant/actions.ts"),
]);

test("cancellation retains event linkage until strict Calendar cleanup succeeds", () => {
  assert.doesNotMatch(cancelSource, /updateErr\?\.message/);
  const cancellationBody = cancelSource.slice(
    cancelSource.indexOf("export async function cancelBooking"),
    cancelSource.indexOf("async function sendCancellationEmail"),
  );
  assert.match(cancellationBody, /\.update\(\{\s*status:\s*"cancelled"\s*}\)/);
  assert.doesNotMatch(
    cancellationBody.slice(0, cancellationBody.indexOf("syncStoredBookingGoogleCalendarEvent")),
    /google_calendar_event_id:\s*null/,
  );
  assert.match(cancellationBody, /syncStoredBookingGoogleCalendarEvent\(/);
  assert.match(cancellationBody, /warning:\s*calendarSynced/);
  assert.match(cancelSource, /calendarWarning:\s*!calendarSynced/);
  assert.match(cancelSource, /Calendar cleanup needs attention:/);

  assert.match(
    serviceSource,
    /from\("assistant_action_logs"\)[\s\S]*google_calendar_reconciliation_required/,
  );
  assert.match(
    serviceSource,
    /calendarCleanupCandidateIds\([\s\S]*booking\.google_calendar_event_id/,
  );
  assert.match(
    serviceSource,
    /from\("integration_jobs"\)[\s\S]*select\("provider_external_id"\)[\s\S]*eq\("organization_id", args\.organizationId\)[\s\S]*eq\("booking_id", args\.bookingId\)[\s\S]*eq\("job_type", "google_calendar\.event\.create"\)/,
  );
  const deleteIndex = serviceSource.indexOf(
    "for (const eventId of cleanupEventIds)",
  );
  assert.match(
    serviceSource.slice(deleteIndex, deleteIndex + 320),
    /deleteEvent\(eventId[\s\S]*bookingId:\s*booking\.id[\s\S]*organizationId:\s*booking\.organization_id/,
  );
  assert.match(
    serviceSource.slice(deleteIndex, deleteIndex + 420),
    /allowMarkerlessLegacy:\s*eventId === booking\.google_calendar_event_id/,
  );
  const clearIndex = serviceSource.indexOf("google_calendar_event_id: null");
  assert.ok(deleteIndex >= 0 && clearIndex > deleteIndex);
  assert.match(serviceSource, /initial\.status === "cancelled"/);
});

test("admin cancellation surfaces Calendar cleanup warnings", () => {
  assert.match(
    adminActions,
    /updateBookingStatus[\s\S]*next === "cancelled"[\s\S]*cancelBookingAsAdmin/,
  );
  assert.match(adminActions, /cancelBookingAsAdmin[\s\S]*warning:\s*result\.warning/);
  assert.match(adminButton, /setWarning\(res\.warning \?\? null\)/);
  assert.match(adminButton, /if \(!res\.warning\) router\.refresh\(\)/);
  assert.match(adminButton, /border-amber-300/);
  assert.match(adminButton, /\{warning\}/);
  assert.doesNotMatch(
    adminButton,
    /will be emailed|Calendar event will be removed/,
  );
  assert.doesNotMatch(bookingActions, /cancelBookingAsAdmin|function cancel\(/);
  assert.match(
    assistantActions,
    /cancelBooking\([\s\S]*result\.warning[\s\S]*Calendar cleanup/,
  );
  assert.doesNotMatch(
    assistantActions,
    /emailed the realtor, removed the Google Calendar event/,
  );
});

test("customer cancellation surfaces Calendar cleanup warnings", () => {
  assert.match(manageActions, /cancelManagedBooking[\s\S]*warning:\s*result\.warning/);
  assert.match(
    manageClient,
    /cancelManagedBooking[\s\S]*kind:\s*result\.warning \? "warning" : "ok"/,
  );
  assert.match(
    manageClient,
    /Your booking has been cancelled[\s\S]*result\.warning/,
  );
  assert.match(manageClient, /if \(!result\.warning\) router\.refresh\(\)/);
  assert.doesNotMatch(
    manageActions,
    /photographer has been notified and will check it/,
  );
});
