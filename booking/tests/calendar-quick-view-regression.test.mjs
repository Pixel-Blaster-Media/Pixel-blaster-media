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
const bookingActionsPath = new URL(
  "../app/admin/bookings/[id]/actions.ts",
  import.meta.url,
);

const calendarSource = await readFile(calendarPath, "utf8");
const calendarActionsSource = await readFile(calendarActionsPath, "utf8");
const calendarPageSource = await readFile(calendarPagePath, "utf8");
const bottomNavSource = await readFile(bottomNavPath, "utf8");
const bookingActionsSource = await readFile(bookingActionsPath, "utf8");
const quickViewSource = calendarSource.slice(
  calendarSource.indexOf("function CalendarQuickView"),
  calendarSource.indexOf("function QuickViewSection"),
);

test("calendar headings keep the date and appointment count in one compact row", () => {
  assert.match(
    calendarPageSource,
    /flex min-w-0 items-baseline justify-between gap-2 md:hidden/,
  );
  assert.match(calendarPageSource, /text-\[clamp\(1\.25rem,6vw,1\.5rem\)\]/);
  assert.match(
    calendarPageSource,
    /flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-right text-\[clamp\(11px,3vw,14px\)\]/,
  );
  assert.match(calendarPageSource, /data-calendar-week-summary/);
  assert.match(calendarPageSource, /formatCompactWeekRange\(weekStart\)/);
  assert.match(calendarPageSource, /month: "short"/);
  assert.match(calendarPageSource, /appointmentCount} appt/);
  assert.match(
    calendarPageSource,
    /max-w-full space-y-4 px-0\.5 md:space-y-2/,
  );
  assert.match(
    calendarPageSource,
    /<header className="-mb-2 px-1 py-1 md:mb-0 md:py-0">/,
  );
  assert.match(
    calendarPageSource,
    /data-calendar-desktop-heading[^>]*className="hidden min-w-0 items-baseline gap-2 md:flex"/,
  );
  assert.match(
    calendarPageSource,
    /className="whitespace-nowrap lg:hidden"[\s\S]{0,100}formatCompactWeekRange\(weekStart\)/,
  );
  assert.match(
    calendarPageSource,
    /className="hidden whitespace-nowrap lg:inline"[\s\S]{0,100}formatWeekRange\(weekStart\)/,
  );
  assert.match(
    calendarPageSource,
    /data-calendar-desktop-count[^>]*className="whitespace-nowrap text-sm text-realtor-muted"/,
  );
  assert.doesNotMatch(
    calendarPageSource,
    /mt-1 hidden text-sm text-realtor-muted md:block/,
  );
});

test("mobile day schedule uses one unified Apple-inspired canvas", () => {
  assert.match(calendarSource, /sticky top-2[^\n]*rounded-3xl/);
  assert.match(calendarSource, /overflow-auto rounded-3xl[^\n]*md:block/);
  assert.match(
    calendarSource,
    /max-w-full overflow-hidden rounded-3xl[^\n]*bg-realtor-surface/,
  );
  assert.match(
    calendarSource,
    /<div className="border-t border-realtor-primary\/10">/,
  );
  assert.match(
    calendarSource,
    /ref=\{mobileTimelineScrollRef\}[\s\S]{0,180}className="h-\[68dvh\][^\n]*overflow-y-auto overscroll-contain \[-webkit-overflow-scrolling:touch\]"/,
  );
  assert.match(
    calendarSource,
    /data-calendar-drop-mode="mobile"[\s\S]{0,160}className="relative overflow-hidden bg-realtor-bg\/60"/,
  );
  assert.doesNotMatch(
    calendarSource,
    /border-t border-realtor-primary\/10 px-3 pb-3 pt-3/,
  );
  assert.match(calendarSource, /function CalendarAgendaView[\s\S]*?<section className="overflow-hidden rounded-3xl/);
  const restrainedEventCards = calendarSource.match(
    /overflow-hidden rounded-xl border border-l-\[3px\] px-(?:2\.5|3)/g,
  );
  assert.ok(
    restrainedEventCards && restrainedEventCards.length >= 2,
    "Mobile and desktop appointment cards should use restrained rounded corners and a leading status edge",
  );
});

test("calendar booking quick view exposes an inline date and time reschedule action", () => {
  assert.match(quickViewSource, /Change date & time/);
  assert.match(quickViewSource, /type="date"/);
  assert.match(quickViewSource, /type="time"/);
  assert.match(
    quickViewSource,
    /rescheduleCalendarShoot\(\s*item\.id,\s*rescheduleDate,\s*startMinutes,?\s*\)/,
  );
});

test("calendar booking quick view edits packages with impact and notification controls", () => {
  assert.match(quickViewSource, /data-calendar-package-editor/);
  assert.match(quickViewSource, /Edit package &amp; add-ons/);
  assert.match(quickViewSource, /Booking impact/);
  assert.match(quickViewSource, /data-calendar-package-overlap-warning/);
  assert.match(quickViewSource, /Email the updated confirmation to the realtor/);
  assert.match(quickViewSource, /Save package changes/);
  assert.match(
    quickViewSource,
    /updateBookingServicesFromCalendar\(item\.id, formData\)/,
  );
  assert.match(
    bookingActionsSource,
    /export async function updateBookingServicesFromCalendar/,
  );
  assert.match(bookingActionsSource, /allow_schedule_overlap: true/);
  assert.match(bookingActionsSource, /quickbooks_invoice_id/);
  assert.match(bookingActionsSource, /syncGoogleCalendarEventBestEffort/);
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

test("calendar surfaces use the shared warm workspace palette", () => {
  assert.match(calendarPageSource, />\s*Schedule\s*</);
  assert.match(calendarSource, /bg-realtor-bg\/60/);
  assert.match(calendarSource, /bg-realtor-soft\/60/);
  assert.match(calendarSource, /border-realtor-primary\/10/);
  assert.match(calendarSource, /grid grid-cols-2 rounded-xl bg-realtor-soft\/70/);
  assert.match(calendarSource, /aria-label="Calendar view"/);
  assert.match(calendarSource, /focus-visible:ring-2/);
  assert.match(
    calendarPageSource,
    /statusClass:\s*calendarStatusPill\(booking\.status\)/,
  );
  assert.doesNotMatch(calendarSource, /#fffdf8|#d8cab9|#d7d1c4|#d0cabd|#ded6c8|#ede6d9/);
  assert.doesNotMatch(calendarSource, /realtor-surface-muted/);
  assert.doesNotMatch(calendarSource, /realtor-primary-light/);
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
