import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseRealtorNotificationPolicy } from "../lib/integrations/realtor-notification-policy.ts";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("admin calendar offers an unchecked quiet-booking control", () => {
  const view = read("app/admin/calendar/CalendarWeekView.tsx");

  assert.match(view, /name="suppress_realtor_notifications"/);
  assert.match(view, /Do not email or invite the realtor/i);
  assert.match(view, /Still creates the booking and internal calendar event/i);
  assert.doesNotMatch(
    view,
    /name="suppress_realtor_notifications"[^>]*defaultChecked/,
  );
});

test("provider dispatch accepts only an explicit boolean notification policy", () => {
  assert.deepEqual(parseRealtorNotificationPolicy(true), {
    ok: true,
    suppressed: true,
  });
  assert.deepEqual(parseRealtorNotificationPolicy(false), {
    ok: true,
    suppressed: false,
  });
  for (const malformed of [null, undefined, 0, 1, "false", {}, []]) {
    assert.deepEqual(parseRealtorNotificationPolicy(malformed), { ok: false });
  }
});

test("admin booking persists quiet mode and every automatic path honors it", () => {
  const actions = read("app/admin/calendar/actions.ts");
  const editActions = read("app/admin/bookings/[id]/actions.ts");
  const manageActions = read("app/book/manage/[token]/actions.ts");
  const manageClient = read("app/book/manage/[token]/ManageBookingClient.tsx");
  const cancelBooking = read("lib/booking/cancel.ts");
  const dispatcher = read("lib/integrations/dispatcher.ts");
  const reminders = read("app/api/cron/reminders/route.ts");
  const migration = read(
    "supabase/migrations/20260720173000_persist_quiet_admin_bookings.sql",
  );

  assert.match(
    actions,
    /const suppressRealtorNotifications\s*=\s*formData\.get\("suppress_realtor_notifications"\)\s*===\s*"on"/,
  );
  assert.match(actions, /suppress_realtor_notifications:\s*suppressRealtorNotifications/);
  assert.match(actions, /notifyRealtor:\s*!suppressRealtorNotifications/);
  assert.match(actions, /if\s*\(!suppressRealtorNotifications\)\s*{[\s\S]*sendConfirmationBestEffort/);
  assert.match(
    actions,
    /\.\.\.\(args\.notifyRealtor\s*\?\s*{[\s\S]*attendeeEmail:[\s\S]*attendeeName:[\s\S]*}\s*:\s*{}\)/,
  );
  assert.match(
    actions,
    /booking\.suppress_realtor_notifications[\s\S]*attendeeEmail/,
  );
  assert.match(
    editActions,
    /notifyRealtor:\s*!booking\.suppress_realtor_notifications/,
  );
  assert.match(
    editActions,
    /shouldSendConfirmation\s*&&\s*!booking\.suppress_realtor_notifications/,
  );
  assert.match(
    editActions,
    /booking\?\.suppress_realtor_notifications\s*\|\|[\s\S]*!booking\?\.profiles\?\.email/,
  );
  assert.match(
    manageActions,
    /!booking\.suppress_realtor_notifications\s*&&\s*booking\.profiles\?\.email/,
  );
  assert.match(
    manageActions,
    /booking\.suppress_realtor_notifications[\s\S]*attendeeEmail/,
  );
  assert.match(
    cancelBooking,
    /suppressRealtorNotifications:\s*booking\.suppress_realtor_notifications/,
  );
  assert.match(
    cancelBooking,
    /args\.initiator\s*===\s*"admin"[\s\S]*args\.suppressRealtorNotifications/,
  );
  assert.match(
    reminders,
    /sendPushBestEffort[\s\S]*if\s*\(booking\.suppress_realtor_notifications\)\s*{[\s\S]*continue;/,
  );
  assert.match(
    dispatcher,
    /loadRealtorNotificationPolicy[\s\S]*suppress_realtor_notifications/,
  );
  const policyCore = read("lib/integrations/realtor-notification-policy.ts");
  assert.match(
    policyCore,
    /typeof value\s*!==\s*"boolean"/,
  );
  assert.match(
    dispatcher,
    /loadRealtorNotificationPolicy[\s\S]*!policy\.ok[\s\S]*outcome:\s*"claim_failed"[\s\S]*claimIntegrationJob/,
  );
  assert.match(
    dispatcher,
    /realtorNotificationsSuppressed[\s\S]*realtor_notifications_suppressed/,
  );
  assert.match(
    dispatcher,
    /realtorNotificationsSuppressed[\s\S]*attendeeEmail/,
  );
  assert.doesNotMatch(
    dispatcher,
    /notification_policy_lookup_failed[\s\S]*status:\s*"retryable"/,
  );
  assert.match(
    editActions,
    /return\s*{\s*ok:\s*true,\s*confirmationSent\s*}/,
  );
  assert.match(
    editActions,
    /return result\.ok\s*&&\s*!result\.skipped/,
  );
  assert.match(
    manageActions,
    /realtorNotified:\s*Boolean\([\s\S]*realtorEmailResult\?\.ok\s*&&\s*!realtorEmailResult\.skipped/,
  );
  assert.match(
    manageActions,
    /realtorNotified\s*=\s*emailResult\.ok\s*&&\s*!emailResult\.skipped/,
  );
  assert.match(
    manageClient,
    /result\.realtorNotified\s*\?\s*" A confirmation email is on the way\."\s*:\s*""/,
  );
  assert.match(
    migration,
    /add column if not exists suppress_realtor_notifications boolean not null default false/i,
  );
});
