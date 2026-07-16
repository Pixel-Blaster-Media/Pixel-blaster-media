import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runGoogleCalendarHealthCheck } from "../lib/integrations/google-calendar/health-check.ts";

const routeSource = readFileSync(
  new URL("../app/api/cron/google-calendar-health/route.ts", import.meta.url),
  "utf8",
);
const clientSource = readFileSync(
  new URL("../lib/integrations/google-calendar/client.ts", import.meta.url),
  "utf8",
);

const requiredScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];

function sources() {
  return [
    {
      calendarId: "primary",
      sourceType: "primary",
      blockAvailability: true,
      writeBookings: true,
      showOnAdminCalendar: true,
    },
    {
      calendarId: "external@example.com",
      sourceType: "external",
      blockAvailability: true,
      writeBookings: false,
      showOnAdminCalendar: true,
    },
  ];
}

function clients({ secondError = null, secondBusy = null } = {}) {
  return [
    { getBusy: async () => [] },
    {
      getBusy: async () => {
        if (secondError) throw new Error(secondError);
        if (secondBusy) return secondBusy;
        return [];
      },
    },
  ];
}

function dependencies(overrides = {}) {
  return {
    loadSources: async () => sources(),
    loadBlockingClients: async () => clients(),
    loadCurrentAccessToken: async () => "fresh-access-token",
    inspectScopes: async () => requiredScopes,
    loadAvailabilityDayCount: async () => 28,
    ...overrides,
  };
}

test("healthy Google Calendar and booking availability pass every check", async () => {
  const report = await runGoogleCalendarHealthCheck({
    ...dependencies(),
    now: new Date("2026-07-16T12:00:00.000Z"),
  });

  assert.deepEqual(report, {
    ok: true,
    failures: [],
    sourceCount: 2,
    blockingSourceCount: 2,
    writeTargetCount: 1,
    adminVisibleSourceCount: 2,
    computedDayCount: 28,
  });
});

test("source drift and a missing scope are both reported", async () => {
  const onlyPrimary = sources().slice(0, 1);
  const report = await runGoogleCalendarHealthCheck({
    ...dependencies({
      loadSources: async () => onlyPrimary,
      loadBlockingClients: async () => clients().slice(0, 1),
      inspectScopes: async () => requiredScopes.slice(0, 1),
    }),
    now: new Date("2026-07-16T12:00:00.000Z"),
  });

  assert.equal(report.ok, false);
  assert.match(report.failures.join("\n"), /expected 2 configured sources/i);
  assert.match(report.failures.join("\n"), /free-busy scope is missing/i);
});

test("source types and calendar identities must remain unique", async () => {
  const duplicated = sources().map((source) => ({
    ...source,
    calendarId: "primary",
    sourceType: "primary",
  }));
  const report = await runGoogleCalendarHealthCheck({
    ...dependencies({ loadSources: async () => duplicated }),
    now: new Date("2026-07-16T12:00:00.000Z"),
  });

  assert.equal(report.ok, false);
  assert.match(report.failures.join("\n"), /one primary and one external/i);
  assert.match(report.failures.join("\n"), /unique calendar identities/i);
});

test("a single blocking calendar freeBusy failure fails without reflecting details", async () => {
  const report = await runGoogleCalendarHealthCheck({
    ...dependencies({
      loadBlockingClients: async () =>
        clients({ secondError: "insufficientPermissions" }),
    }),
    now: new Date("2026-07-16T12:00:00.000Z"),
  });

  assert.equal(report.ok, false);
  assert.match(report.failures.join("\n"), /freeBusy source 2 failed/i);
  assert.doesNotMatch(report.failures.join("\n"), /insufficientPermissions/);
});

test("freeBusy calls are bounded by an explicit timeout", async () => {
  const never = new Promise(() => {});
  const report = await runGoogleCalendarHealthCheck({
    ...dependencies({
      loadBlockingClients: async () => [
        { getBusy: async () => [] },
        { getBusy: async () => never },
      ],
    }),
    busyTimeoutMs: 5,
    now: new Date("2026-07-16T12:00:00.000Z"),
  });

  assert.equal(report.ok, false);
  assert.match(report.failures.join("\n"), /freeBusy source 2 failed/i);
});

test("token refresh or client initialization failure is generic and secret-free", async () => {
  const report = await runGoogleCalendarHealthCheck({
    ...dependencies({
      loadBlockingClients: async () => {
        throw new Error("refresh_token=secret-value invalid_grant");
      },
    }),
    now: new Date("2026-07-16T12:00:00.000Z"),
  });

  assert.equal(report.ok, false);
  assert.match(report.failures.join("\n"), /initialize Google Calendar clients/i);
  assert.doesNotMatch(report.failures.join("\n"), /secret-value|invalid_grant/);
});

test("availability calculation must return the complete 28-day contract", async () => {
  const report = await runGoogleCalendarHealthCheck({
    ...dependencies({ loadAvailabilityDayCount: async () => 27 }),
    now: new Date("2026-07-16T12:00:00.000Z"),
  });

  assert.equal(report.ok, false);
  assert.match(report.failures.join("\n"), /expected 28 computed availability days/i);
  assert.equal(report.computedDayCount, 27);
});

test("health route requires its dedicated secret before running checks", () => {
  const authIndex = routeSource.indexOf("GOOGLE_CALENDAR_WATCHDOG_SECRET");
  const checkIndex = routeSource.indexOf("runGoogleCalendarHealthCheck(");
  assert.ok(authIndex >= 0 && checkIndex > authIndex);
  assert.match(routeSource, /authorization.*Bearer/s);
  assert.match(routeSource, /status:\s*401/);
  assert.match(routeSource, /report\.ok\s*\?\s*200\s*:\s*503/);
  assert.equal(
    (routeSource.match(/headers:\s*NO_STORE_HEADERS/g) ?? []).length,
    3,
    "200, 401, and 503 paths must all explicitly disable caching",
  );
});

test("health route is event-read-only and keeps the token out of URLs", () => {
  assert.match(routeSource, /getGoogleCalendarSources/);
  assert.match(routeSource, /getGoogleCalendarClients/);
  assert.match(routeSource, /getGoogleCalendarConnection/);
  assert.match(routeSource, /loadSlotsForNextDays/);
  assert.match(routeSource, /oauth2\.googleapis\.com\/tokeninfo/);
  assert.match(routeSource, /method:\s*"POST"/);
  assert.match(routeSource, /body:\s*new URLSearchParams/);
  assert.doesNotMatch(routeSource, /searchParams\.set\("access_token"/);
  assert.doesNotMatch(
    routeSource,
    /createEvent|updateEvent|deleteEvent|exchangeCodeForTokens/,
  );
});

test("the shared Google freeBusy request is abortable for every caller", () => {
  const start = clientSource.indexOf("async function queryFreeBusy(");
  const end = clientSource.indexOf("async function listEvents(", start);
  assert.ok(start >= 0 && end > start);
  const queryFreeBusySource = clientSource.slice(start, end);
  assert.match(queryFreeBusySource, /signal:\s*AbortSignal\.timeout\(/);
});
