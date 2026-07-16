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
const calendarPagePath = new URL(
  "../app/admin/calendar/page.tsx",
  import.meta.url,
);
const bottomNavPath = new URL("../app/admin/AdminBottomNav.tsx", import.meta.url);

const calendarSource = await readFile(calendarPath, "utf8");
const calendarActionsSource = await readFile(calendarActionsPath, "utf8");
const calendarPageSource = await readFile(calendarPagePath, "utf8");
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

test("booking quick view defaults to a compact operational summary", () => {
  assert.match(quickViewSource, /data-calendar-quick-summary/);
  assert.match(quickViewSource, />Client</);
  assert.match(quickViewSource, />Services</);
  assert.match(quickViewSource, />Open job</);
  assert.match(quickViewSource, />Directions</);
  assert.match(quickViewSource, />Call</);
  assert.ok(
    quickViewSource.indexOf(">Open job") <
      quickViewSource.indexOf("Change date & time"),
    "Primary job action should appear before secondary scheduling controls",
  );
});

test("property facts and notes are collapsed behind one secondary disclosure", () => {
  assert.match(quickViewSource, /More booking details/);
  assert.match(
    quickViewSource,
    /<details[^>]*data-calendar-more-details[^>]*>/,
  );
  assert.doesNotMatch(
    quickViewSource,
    /<details[^>]*data-calendar-more-details[^>]*\bopen\b/,
  );
  assert.ok(
    quickViewSource.indexOf("More booking details") <
      quickViewSource.indexOf("QuickViewFact"),
    "Property facts should live inside the collapsed disclosure",
  );
});

test("pre-existing Google Calendar drift stays visible in the compact summary", () => {
  assert.match(calendarPageSource, /syncWarning:\s*googleOutOfSync/);
  assert.match(quickViewSource, /item\.syncWarning/);
  assert.match(
    quickViewSource,
    /role="alert"[^>]*data-calendar-sync-warning/,
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
