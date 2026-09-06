import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  bookingActions,
  editForm,
  rescheduleForm,
  calendarActions,
  calendarView,
  bookingPage,
  inboxActions,
  manageActions,
  manageClient,
  calendarService,
  assistantActions,
  calendarPageSource,
  availabilitySource,
  assistantClient,
] = await Promise.all([
  read("app/admin/bookings/[id]/actions.ts"),
  read("app/admin/bookings/[id]/EditBookingForm.tsx"),
  read("app/admin/bookings/[id]/RescheduleBookingForm.tsx"),
  read("app/admin/calendar/actions.ts"),
  read("app/admin/calendar/CalendarWeekView.tsx"),
  read("app/admin/bookings/[id]/page.tsx"),
  read("app/admin/inbox/[id]/actions.ts"),
  read("app/book/manage/[token]/actions.ts"),
  read("app/book/manage/[token]/ManageBookingClient.tsx"),
  read("lib/booking/calendar-event-service.ts"),
  read("app/admin/assistant/actions.ts"),
  read("app/admin/calendar/page.tsx"),
  read("lib/booking/availability.ts"),
  read("app/admin/AdminAssistant.tsx"),
]);

test("a configured but unavailable Calendar client fails instead of reporting skipped", () => {
  assert.match(calendarService, /getGoogleCalendarConnection\(\{ organizationId \}\)/);
  assert.match(calendarService, /if \(!connection\) return null/);
  assert.match(
    calendarService,
    /if \(!client\)[\s\S]*Configured Google Calendar client is unavailable/,
  );
});

test("admin detail saves and reschedules render Calendar warnings", () => {
  assert.match(
    bookingActions,
    /warning:\s*combineActionWarnings\([\s\S]*calendarSynced[\s\S]*Google Calendar did not sync/,
  );
  assert.match(
    bookingActions,
    /warning:\s*combineActionWarnings\([\s\S]*result\.warning/,
  );

  for (const form of [editForm, rescheduleForm]) {
    assert.match(form, /setWarning\(result\.warning \?\? null\)/);
    assert.match(form, /border-amber-300/);
    assert.match(form, /\{warning\}/);
  }
});

test("calendar create, drag, and inbox acceptance preserve warnings across redirects", () => {
  assert.match(calendarActions, /warning:\s*combineWarnings\(/);
  assert.match(calendarActions, /Google Calendar did not sync/);
  assert.match(calendarActions, /confirmation is pending or needs integration review/);
  assert.match(calendarActions, /return \{ ok: true, warning, bookingId: booking\.id \}/);
  assert.match(calendarView, /result\.warningCode[\s\S]*follow_up=\$\{warningCode\}/);
  assert.match(
    inboxActions,
    /!calendarSynced && !confirmationSent[\s\S]*calendar_and_email_failed[\s\S]*confirmation_email_failed[\s\S]*\?follow_up=\$\{followUp\}/,
  );
  assert.match(
    inboxActions,
    /sendShootConfirmedEmail[\s\S]*Promise<boolean>[\s\S]*result\.ok[\s\S]*!result\.skipped/,
  );
  assert.match(bookingPage, /query\.calendar_sync === "failed"/);
  assert.match(bookingPage, /followUpWarningMessage\(query\.follow_up\)/);
  assert.match(bookingPage, /calendar_and_email_failed/);
  assert.match(bookingPage, /Google Calendar did not sync/);
});

test("customer-managed rescheduling displays a distinct Calendar warning", () => {
  assert.match(
    manageActions,
    /warning:\s*calendarSynced[\s\S]*Google Calendar did not sync/,
  );
  assert.match(manageClient, /kind:\s*result\.warning \? "warning" : "ok"/);
  assert.match(manageClient, /result\.warning \? `\s*\$\{result\.warning\}`/);
  assert.match(manageClient, /flash\.kind === "warning"/);
  assert.match(manageClient, /border-amber-500/);
});

test("assistant creation and cancellation preserve Calendar warnings without false delivery claims", () => {
  assert.match(
    assistantActions,
    /createAdminShoot\([\s\S]*result\.warning[\s\S]*follow-up needs attention/,
  );
  assert.match(
    assistantActions,
    /cancelBooking\([\s\S]*result\.warning[\s\S]*Calendar cleanup/,
  );
  assert.doesNotMatch(
    assistantActions,
    /emailed the realtor, removed the Google Calendar event/,
  );
  assert.doesNotMatch(assistantActions, /completed its configured follow-up work/);
  assert.match(
    assistantActions,
    /updateBookingStatus\([\s\S]*result\.warning[\s\S]*needs attention/,
  );
  assert.doesNotMatch(manageClient, /notifies the photographer/);
  assert.doesNotMatch(manageClient, /frees up the slot/);
});

test("admin creation checks durable dispatch outcomes and aggregates independent warnings", () => {
  assert.match(
    calendarActions,
    /dispatchBookingIntegrationJobs\([\s\S]*jobType === "email.booking.confirmation"[\s\S]*confirmationWarning/,
  );
  assert.doesNotMatch(calendarActions, /await sendConfirmationBestEffort\(/);
  assert.match(calendarActions, /warning: combineWarnings\([\s\S]*confirmationWarning/);
  assert.doesNotMatch(
    calendarActions,
    /confirmation email failed",\s*err/,
  );
});

test("Calendar mutation failures are logged without raw caught objects", () => {
  assert.doesNotMatch(calendarPageSource, /bookingsRes\.error\?\.message/);
  assert.doesNotMatch(calendarPageSource, /group\.reason/);
  assert.doesNotMatch(calendarPageSource, /google events fetch failed",\s*err/);
  assert.doesNotMatch(availabilitySource, /google freeBusy failed",\s*err/);
  assert.doesNotMatch(calendarService, /reconciliation log failed",\s*\{/);
  assert.match(
    calendarService,
    /for \(let attempt = 0; attempt < 3; attempt \+= 1\)[\s\S]*assistant_action_logs[\s\S]*reconciliation persistence failed/,
  );
  assert.doesNotMatch(
    calendarService,
    /google_calendar_event_id:\s*failure\.eventId/,
    "unverified collision IDs must never be promoted to trusted booking links",
  );
  assert.doesNotMatch(calendarActions, /confirmation email failed",\s*err/);
  assert.doesNotMatch(
    bookingActions,
    /\b(?:err|error|[A-Za-z]+Error|[A-Za-z]+Err)\??\.message\b/,
  );
  assert.doesNotMatch(bookingActions, /listExistingIGuides[\s\S]*result\.error/);
  assert.doesNotMatch(assistantActions, /\b(?:error|readError|existingError|updateErr|lineItemError|deliverableError)\.message\b/);
  assert.doesNotMatch(assistantActions, /openAiErrorMessage/);
  assert.doesNotMatch(
    assistantActions,
    /\[admin-assistant\][^\n]*,\s*(?:err|error|[A-Za-z]+Error)/,
  );
  assert.doesNotMatch(assistantClient, /err\.message|String\(err\)/);
  assert.doesNotMatch(inboxActions, /\[(?:accept|accept\.email)\][^\n]*,\s*(?:err|error|acceptErr)/);
  assert.doesNotMatch(inboxActions, /error\?\.message/);
  assert.doesNotMatch(inboxActions, /error:\s*error\.message/);
  assert.doesNotMatch(inboxActions, /existing profile lookup failed",/);
  assert.doesNotMatch(bookingActions, /ambiguous outbox guard failed closed",/);
  assert.doesNotMatch(inboxActions, /error:\s*(?:result|ccResult)\.ok\s*\?[^\n]*(?:result|ccResult)\.error/);
});
