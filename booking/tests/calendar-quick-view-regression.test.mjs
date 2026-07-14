import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const calendarPath = new URL(
  "../app/admin/calendar/CalendarWeekView.tsx",
  import.meta.url,
);
const calendarActionsPath = new URL(
  "../app/admin/calendar/actions.ts",
  import.meta.url,
);
const bottomNavPath = new URL("../app/admin/AdminBottomNav.tsx", import.meta.url);

const calendarSource = await readFile(calendarPath, "utf8");
const calendarActionsSource = await readFile(calendarActionsPath, "utf8");
const bottomNavSource = await readFile(bottomNavPath, "utf8");
const quickViewSource = calendarSource.slice(
  calendarSource.indexOf("function CalendarQuickView"),
  calendarSource.indexOf("function QuickViewSection"),
);

test("calendar booking quick view exposes an inline date and time reschedule action", () => {
  assert.match(quickViewSource, /Change date & time/);
  assert.match(quickViewSource, /type="date"/);
  assert.match(quickViewSource, /type="time"/);
  assert.match(
    quickViewSource,
    /rescheduleCalendarShoot\(\s*item\.id,\s*rescheduleDate,\s*startMinutes,?\s*\)/,
  );
});

test("mobile admin navigation stays visible without covering calendar bottom sheets", () => {
  assert.match(bottomNavSource, /z-\[210\]/);
  const reservedNavOffsets = calendarSource.match(
    /bottom-\[calc\(6rem\+env\(safe-area-inset-bottom\)\)\]/g,
  );
  assert.ok(
    reservedNavOffsets && reservedNavOffsets.length >= 2,
    "Both the quick view and create sheet must reserve room for mobile navigation",
  );
});

test("rescheduling surfaces Google Calendar sync warnings and rejected actions", () => {
  assert.match(calendarActionsSource, /warning\?: string/);
  assert.match(calendarActionsSource, /return \{ ok: true, warning/);
  assert.match(
    calendarActionsSource,
    /if \(!gcal && booking\.google_calendar_event_id\)/,
  );
  assert.match(calendarActionsSource, /error: calendarLinkError/);
  assert.match(calendarActionsSource, /if \(calendarLinkError\)/);
  assert.match(quickViewSource, /result\.warning/);
  assert.match(quickViewSource, /catch \(error\)/);
});
