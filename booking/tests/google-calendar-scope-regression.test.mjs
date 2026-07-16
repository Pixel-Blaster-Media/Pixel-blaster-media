import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { missingGrantedScopes } from "../lib/integrations/google-calendar/scope-grants.ts";

const oauthSource = await readFile(
  new URL("../lib/integrations/google-calendar/oauth.ts", import.meta.url),
  "utf8",
);
const connectButtonSource = await readFile(
  new URL(
    "../app/admin/settings/integrations/GoogleConnectButton.tsx",
    import.meta.url,
  ),
  "utf8",
);
const integrationsPageSource = await readFile(
  new URL("../app/admin/settings/integrations/page.tsx", import.meta.url),
  "utf8",
);
const calendarClientSource = await readFile(
  new URL("../lib/integrations/google-calendar/client.ts", import.meta.url),
  "utf8",
);
const integrationActionsSource = await readFile(
  new URL("../app/admin/settings/integrations/actions.ts", import.meta.url),
  "utf8",
);
const calendarTesterSource = await readFile(
  new URL(
    "../app/admin/settings/integrations/GoogleCalendarTester.tsx",
    import.meta.url,
  ),
  "utf8",
);
const googleCallbackSource = await readFile(
  new URL(
    "../app/api/integrations/google-calendar/callback/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("Google OAuth requests event write and free-busy access", () => {
  assert.match(
    oauthSource,
    /https:\/\/www\.googleapis\.com\/auth\/calendar\.events["']/,
  );
  assert.match(
    oauthSource,
    /https:\/\/www\.googleapis\.com\/auth\/calendar\.events\.freebusy["']/,
  );
  assert.doesNotMatch(
    oauthSource,
    /https:\/\/www\.googleapis\.com\/auth\/calendar["']/,
    "Do not broaden OAuth to full Google Calendar access",
  );
});

test("granular OAuth grants must include both Calendar capabilities", () => {
  const eventScope = "https://www.googleapis.com/auth/calendar.events";
  const freeBusyScope =
    "https://www.googleapis.com/auth/calendar.events.freebusy";
  const required = [eventScope, freeBusyScope];

  assert.deepEqual(
    missingGrantedScopes(`${eventScope} ${freeBusyScope}`, required),
    [],
  );
  assert.deepEqual(missingGrantedScopes(eventScope, required), [freeBusyScope]);
  assert.deepEqual(missingGrantedScopes(freeBusyScope, required), [eventScope]);
  assert.deepEqual(missingGrantedScopes(undefined, required), required);
  assert.deepEqual(
    missingGrantedScopes(
      `openid email ${freeBusyScope} ${eventScope} extra.scope`,
      required,
    ),
    [],
  );
});

test("callback rejects partial Calendar grants before replacing tokens", () => {
  const scopeCheckIndex = googleCallbackSource.search(
    /missingGrantedScopes\(\s*tokens\.scope/,
  );
  const persistIndex = googleCallbackSource.indexOf("await persistTokens(");
  assert.ok(scopeCheckIndex >= 0, "Callback must inspect the granted scopes");
  assert.ok(
    persistIndex > scopeCheckIndex,
    "Scope validation must finish before tokens are persisted",
  );
  assert.match(googleCallbackSource, /missing_calendar_scopes/);
  assert.match(
    integrationsPageSource,
    /both\s+event\s+access\s+and\s+busy-time\s+access/i,
  );
});

test("reconnect cannot silently switch the connected Google account", () => {
  const mismatchIndex = googleCallbackSource.indexOf("google_account_mismatch");
  const persistIndex = googleCallbackSource.indexOf("await persistTokens(");
  assert.ok(mismatchIndex >= 0 && mismatchIndex < persistIndex);
  assert.match(
    integrationsPageSource,
    /disconnect\s+first\s+to\s+switch\s+accounts/i,
  );
});

test("connected calendars can re-consent without disconnecting first", () => {
  assert.match(connectButtonSource, /label\s*=\s*"Connect Google Calendar"/);
  assert.match(
    integrationsPageSource,
    /<GoogleConnectButton\s+label="Reconnect Google Calendar"\s*\/>/,
  );
  assert.match(
    integrationsPageSource,
    /current\s+connection\s+stays\s+active\s+unless\s+the\s+new\s+Google\s+consent\s+succeeds/i,
  );
});

test("external calendar sources reuse the primary connection token", () => {
  assert.match(
    calendarClientSource,
    /const tokenSource = rows\.find\(\(row\) => row\.write_bookings\) \?\? rows\[0\]/,
  );
  assert.match(
    calendarClientSource,
    /const sharedAccessToken = await ensureAccessToken\(/,
  );
  assert.match(
    calendarClientSource,
    /return Promise\.all\(\s*rows\.map\(\(row\) =>\s*clientFromConnection\(row, clientId, clientSecret, sharedAccessToken\)/,
  );
});

test("source filters cannot exclude the primary token connection", () => {
  assert.match(
    calendarClientSource,
    /await getGoogleCalendarConnection\(\{\s*organizationId: organizationId\(scope\),\s*\}\)/,
  );
});

test("empty source filters return before refreshing the primary token", () => {
  const rowsIndex = calendarClientSource.indexOf(
    "const rows = await getGoogleCalendarConnections(scope)",
  );
  const emptyIndex = calendarClientSource.indexOf(
    "if (rows.length === 0) return []",
    rowsIndex,
  );
  const primaryIndex = calendarClientSource.indexOf(
    "const primaryTokenSource = await getGoogleCalendarConnection",
    rowsIndex,
  );
  assert.ok(rowsIndex >= 0 && emptyIndex > rowsIndex && primaryIndex > emptyIndex);
});

test("calendar diagnostics verify free-busy before creating a test event", () => {
  const getBusyIndex = integrationActionsSource.indexOf("await client.getBusy(");
  const createEventIndex = integrationActionsSource.indexOf(
    "await client.createEvent(",
  );
  assert.ok(getBusyIndex >= 0, "Calendar diagnostic must query free/busy");
  assert.ok(
    createEventIndex > getBusyIndex,
    "Free/busy must pass before a test event is created",
  );
  assert.match(calendarTesterSource, /checks busy-time access/i);
  assert.match(calendarTesterSource, /role="status"/);
  assert.match(calendarTesterSource, /aria-live="polite"/);
});

test("only free-busy insufficient-permission errors request reconnect", () => {
  const getBusyIndex = integrationActionsSource.indexOf("await client.getBusy(");
  const reconnectIndex = integrationActionsSource.indexOf(
    "Busy-time access is missing. Reconnect Google Calendar",
  );
  const createEventIndex = integrationActionsSource.indexOf(
    "await client.createEvent(",
  );

  assert.ok(getBusyIndex >= 0);
  assert.ok(
    reconnectIndex > getBusyIndex && reconnectIndex < createEventIndex,
    "Reconnect handling must be isolated to the pre-write free/busy check",
  );
  assert.match(
    integrationActionsSource,
    /err\.reason === "insufficientPermissions"/,
  );
  assert.match(calendarClientSource, /googleCalendarErrorReason\(body\)/);
});

test("re-consent updates tokens without resetting calendar source settings", () => {
  const tokenPayloadStart = calendarClientSource.indexOf("const tokenPayload = {");
  const sourcePayloadStart = calendarClientSource.indexOf(
    "const sourcePayload = {",
  );
  assert.ok(tokenPayloadStart >= 0, "A token-only update payload must exist");
  assert.ok(sourcePayloadStart > tokenPayloadStart);

  const tokenPayload = calendarClientSource.slice(
    tokenPayloadStart,
    sourcePayloadStart,
  );
  assert.doesNotMatch(
    tokenPayload,
    /calendar_id|display_name|source_color|source_type|show_on_admin_calendar|block_availability|write_bookings/,
  );
  assert.match(calendarClientSource, /\.update\(tokenPayload\)/);
});
