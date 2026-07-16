import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  googleCalendarCallbackRelayUri,
  googleCalendarCanonicalConnectPageUri,
  googleCalendarRedirectUri,
} from "../lib/integrations/google-calendar/redirect-uri.ts";
import {
  buildGoogleCalendarOAuthState,
  googleCalendarOAuthStateMatchesAdmin,
} from "../lib/integrations/google-calendar/oauth-state.ts";
import {
  googleCalendarCallbackHasRelayControls,
  googleCalendarCallbackRelayIsVerified,
  signGoogleCalendarCallbackRelayUri,
} from "../lib/integrations/google-calendar/callback-relay.ts";
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

const canonicalAppUrl = "https://www.pixelblastermedia.com";
const canonicalCallback =
  `${canonicalAppUrl}/api/integrations/google-calendar/callback`;
const authorizedCallback =
  "https://pixel-blaster-media.vercel.app/api/integrations/google-calendar/callback";

test("Google OAuth state is bound to the initiating admin and organization", () => {
  const state = buildGoogleCalendarOAuthState("user-a", "organization-a");
  assert.match(state, /^[a-f0-9]{48}\.[a-f0-9]{32}$/);
  assert.equal(
    googleCalendarOAuthStateMatchesAdmin(
      state,
      "user-a",
      "organization-a",
    ),
    true,
  );
  assert.equal(
    googleCalendarOAuthStateMatchesAdmin(
      state,
      "user-b",
      "organization-a",
    ),
    false,
  );
  assert.equal(
    googleCalendarOAuthStateMatchesAdmin(
      state,
      "user-a",
      "organization-b",
    ),
    false,
  );
  assert.equal(
    googleCalendarOAuthStateMatchesAdmin(
      "malformed",
      "user-a",
      "organization-a",
    ),
    false,
  );
});

test("dedicated Google callback overrides and trims the general app URL", () => {
  assert.equal(
    googleCalendarRedirectUri(
      canonicalAppUrl,
      `  ${authorizedCallback}  `,
    ),
    authorizedCallback,
  );
  assert.equal(
    googleCalendarRedirectUri(canonicalAppUrl, "   "),
    `${canonicalAppUrl}/api/integrations/google-calendar/callback`,
  );
});

test("Google callback configuration rejects unsafe or malformed URIs", () => {
  const unsafe = [
    "/api/integrations/google-calendar/callback",
    "http://pixel-blaster-media.vercel.app/api/integrations/google-calendar/callback",
    "https://user:pass@pixel-blaster-media.vercel.app/api/integrations/google-calendar/callback",
    "https://pixel-blaster-media.vercel.app/wrong",
    `${authorizedCallback}?tenant=other`,
    `${authorizedCallback}#fragment`,
    `${authorizedCallback}?`,
    `${authorizedCallback}#`,
    `${authorizedCallback}?#`,
    authorizedCallback.replace("https://", "https://:@"),
  ];
  for (const candidate of unsafe) {
    assert.throws(
      () => googleCalendarRedirectUri(canonicalAppUrl, candidate),
      /Google Calendar redirect URI/,
      candidate,
    );
  }
  assert.throws(
    () => googleCalendarRedirectUri("not-an-app-url", authorizedCallback),
    /NEXT_PUBLIC_APP_URL/,
  );
});

test("Google OAuth kickoff is pinned to the canonical signed-in host", () => {
  assert.equal(
    googleCalendarCanonicalConnectPageUri(
      canonicalAppUrl,
      "www.pixelblastermedia.com",
    ),
    null,
  );
  assert.equal(
    googleCalendarCanonicalConnectPageUri(
      canonicalAppUrl,
      "pixel-blaster-media.vercel.app",
    ),
    `${canonicalAppUrl}/admin/settings/integrations?google_connect_host=1`,
  );
  assert.equal(
    googleCalendarCanonicalConnectPageUri(
      canonicalAppUrl,
      "pixel-blaster-media.vercel.app",
      canonicalAppUrl,
    ),
    null,
    "canonical browser origin must survive the www-to-booking Vercel rewrite",
  );
  assert.equal(
    googleCalendarCanonicalConnectPageUri(
      canonicalAppUrl,
      "pixel-blaster-media.vercel.app",
      null,
      `${canonicalAppUrl}/admin/settings/integrations`,
    ),
    null,
    "canonical browser referer must survive the www-to-booking Vercel rewrite",
  );
  assert.equal(
    googleCalendarCanonicalConnectPageUri(
      canonicalAppUrl,
      "pixel-blaster-media.vercel.app",
      null,
      `${canonicalAppUrl}/admin/settings/integrations?google_error=access_denied`,
    ),
    null,
  );
  assert.equal(
    googleCalendarCanonicalConnectPageUri(
      canonicalAppUrl,
      "pixel-blaster-media.vercel.app",
      null,
      "https://pixel-blaster-media.vercel.app/admin/settings/integrations",
    ),
    `${canonicalAppUrl}/admin/settings/integrations?google_connect_host=1`,
  );
  assert.equal(
    googleCalendarCanonicalConnectPageUri(
      canonicalAppUrl,
      "pixel-blaster-media.vercel.app",
      canonicalAppUrl,
      "malformed lower-priority referer",
    ),
    null,
  );
  assert.equal(
    googleCalendarCanonicalConnectPageUri(
      canonicalAppUrl,
      "pixel-blaster-media.vercel.app",
      "https://pixel-blaster-media.vercel.app",
      `${canonicalAppUrl}/admin/settings/integrations`,
    ),
    `${canonicalAppUrl}/admin/settings/integrations?google_connect_host=1`,
  );
  for (const malformedReferer of [
    "",
    "null",
    "http://www.pixelblastermedia.com/admin/settings/integrations",
    "https://user@www.pixelblastermedia.com/admin/settings/integrations",
    `${canonicalAppUrl}/admin/settings/business`,
    `${canonicalAppUrl}/admin/settings/integrations/`,
    `${canonicalAppUrl}/admin/settings/integrations#fragment`,
    ` ${canonicalAppUrl}/admin/settings/integrations`,
    `${canonicalAppUrl}/admin/settings/integrations,https://attacker.example`,
    "https:\\www.pixelblastermedia.com/admin/settings/integrations",
    "https://www.pixelblastermedia.com:443/admin/settings/integrations",
  ]) {
    assert.throws(
      () =>
        googleCalendarCanonicalConnectPageUri(
          canonicalAppUrl,
          "pixel-blaster-media.vercel.app",
          null,
          malformedReferer,
        ),
      /request referer/i,
      malformedReferer,
    );
  }
  assert.equal(
    googleCalendarCanonicalConnectPageUri(
      canonicalAppUrl,
      "www.pixelblastermedia.com",
      "https://pixel-blaster-media.vercel.app",
    ),
    `${canonicalAppUrl}/admin/settings/integrations?google_connect_host=1`,
  );
  assert.throws(
    () =>
      googleCalendarCanonicalConnectPageUri(
        canonicalAppUrl,
        "pixel-blaster-media.vercel.app",
        `${canonicalAppUrl}/unexpected-path`,
      ),
    /request origin/i,
  );
  for (const malformedOrigin of [
    "",
    "null",
    "http://www.pixelblastermedia.com",
    "https://user@www.pixelblastermedia.com",
    `${canonicalAppUrl}/`,
    `${canonicalAppUrl}?`,
    `${canonicalAppUrl}#`,
    ` ${canonicalAppUrl}`,
    `${canonicalAppUrl},https://attacker.example`,
    "https:\\www.pixelblastermedia.com",
  ]) {
    assert.throws(
      () =>
        googleCalendarCanonicalConnectPageUri(
          canonicalAppUrl,
          "pixel-blaster-media.vercel.app",
          malformedOrigin,
        ),
      /request origin/i,
      malformedOrigin,
    );
  }
  assert.equal(
    googleCalendarCanonicalConnectPageUri(
      "http://localhost:3000",
      "localhost:3000",
      "http://localhost:3000",
    ),
    null,
  );
  assert.throws(
    () => googleCalendarCanonicalConnectPageUri(canonicalAppUrl, null),
    /request host/i,
  );
  assert.throws(
    () =>
      googleCalendarCanonicalConnectPageUri(
        canonicalAppUrl,
        "attacker.example, www.pixelblastermedia.com",
      ),
    /request host/i,
  );
  for (const malformedHost of [
    "www.pixelblastermedia.com/",
    "www.pixelblastermedia.com\\",
    "@www.pixelblastermedia.com",
    "www.pixelblastermedia.com:",
    "www.pixelblastermedia.com?",
    "www.pixelblastermedia.com#",
    " www.pixelblastermedia.com",
    "www.pixelblastermedia.com ",
  ]) {
    assert.throws(
      () =>
        googleCalendarCanonicalConnectPageUri(
          canonicalAppUrl,
          malformedHost,
        ),
      /request host/i,
      malformedHost,
    );
  }
  for (const sourceHeaders of [
    { origin: canonicalAppUrl, referer: null },
    {
      origin: null,
      referer: `${canonicalAppUrl}/admin/settings/integrations`,
    },
  ]) {
    assert.throws(
      () =>
        googleCalendarCanonicalConnectPageUri(
          canonicalAppUrl,
          "www.pixelblastermedia.com/",
          sourceHeaders.origin,
          sourceHeaders.referer,
        ),
      /request host/i,
      "Host validation must run before canonical Origin or Referer trust",
    );
  }
});

test("Google OAuth kickoff passes the browser origin through proxy routing", () => {
  assert.match(
    integrationActionsSource,
    /const requestOrigin = requestHeaders\.get\("origin"\)/,
  );
  assert.match(
    integrationActionsSource,
    /const requestReferer = requestHeaders\.get\("referer"\)/,
  );
  assert.match(
    integrationActionsSource,
    /googleCalendarCanonicalConnectPageUri\(\s*appUrl,\s*requestHost,\s*requestOrigin,\s*requestReferer,?\s*\)/,
  );
});

test("authorized callback relays only OAuth fields to the canonical host", () => {
  const request =
    `${authorizedCallback}?code=one-time-code&state=csrf-token` +
    "&scope=calendar&authuser=0&attacker=drop-me";
  assert.equal(
    googleCalendarCallbackRelayUri(
      request,
      canonicalAppUrl,
      authorizedCallback,
    ),
    `${canonicalAppUrl}/api/integrations/google-calendar/callback?code=one-time-code&state=csrf-token`,
  );
  assert.equal(
    googleCalendarCallbackRelayUri(
      `${canonicalAppUrl}/api/integrations/google-calendar/callback?code=one-time-code&state=csrf-token`,
      canonicalAppUrl,
      authorizedCallback,
    ),
    null,
  );
  assert.equal(
    googleCalendarCallbackRelayUri(
      `${authorizedCallback}?error=access_denied&state=csrf-token&error_description=drop-me`,
      canonicalAppUrl,
      authorizedCallback,
    ),
    `${canonicalAppUrl}/api/integrations/google-calendar/callback?state=csrf-token&error=access_denied`,
  );
  assert.throws(
    () =>
      googleCalendarCallbackRelayUri(
        "https://attacker.example/api/integrations/google-calendar/callback?code=x&state=y",
        canonicalAppUrl,
        authorizedCallback,
      ),
    /callback origin/i,
  );
});

test("signed callback relay survives the canonical Vercel proxy hop", () => {
  const secret = "unit-test-relay-secret";
  const canonicalRelay = `${canonicalCallback}?code=one-time-code&state=csrf-token`;
  const signed = signGoogleCalendarCallbackRelayUri(
    canonicalRelay,
    canonicalCallback,
    secret,
  );
  const proxied = new URL(signed);
  proxied.host = "pixel-blaster-media.vercel.app";

  assert.equal(
    googleCalendarCallbackRelayIsVerified(
      proxied.toString(),
      canonicalCallback,
      secret,
    ),
    true,
  );
  assert.equal(googleCalendarCallbackHasRelayControls(canonicalRelay), false);
  assert.equal(googleCalendarCallbackHasRelayControls(proxied.toString()), true);
  assert.equal(
    googleCalendarCallbackRelayIsVerified(
      canonicalRelay,
      canonicalCallback,
      secret,
    ),
    false,
    "unsigned callbacks must not bypass the first relay hop",
  );

  const deniedRelay = `${canonicalCallback}?state=csrf-token&error=access_denied`;
  const signedDenied = new URL(
    signGoogleCalendarCallbackRelayUri(
      deniedRelay,
      canonicalCallback,
      secret,
    ),
  );
  signedDenied.host = "pixel-blaster-media.vercel.app";
  assert.equal(
    googleCalendarCallbackRelayIsVerified(
      signedDenied.toString(),
      canonicalCallback,
      secret,
    ),
    true,
  );

  for (const mutate of [
    (url) => url.searchParams.set("state", "tampered-state"),
    (url) => url.searchParams.set("code", "tampered-code"),
    (url) => url.searchParams.set("error", "tampered-error"),
    (url) => url.searchParams.set("unexpected", "drop-me"),
    (url) => url.searchParams.append("state", "duplicate-state"),
    (url) => url.searchParams.set("_google_relay", "0"),
    (url) => url.searchParams.set("_google_relay_sig", "0".repeat(64)),
  ]) {
    const tampered = new URL(proxied);
    mutate(tampered);
    assert.equal(
      googleCalendarCallbackRelayIsVerified(
        tampered.toString(),
        canonicalCallback,
        secret,
      ),
      false,
    );
  }
  assert.equal(
    googleCalendarCallbackRelayIsVerified(
      proxied.toString(),
      canonicalCallback,
      "wrong-secret",
    ),
    false,
  );

  const noncanonicalRelay = new URL(canonicalRelay);
  noncanonicalRelay.host = "pixel-blaster-media.vercel.app";
  assert.throws(
    () =>
      signGoogleCalendarCallbackRelayUri(
        noncanonicalRelay.toString(),
        canonicalCallback,
        secret,
      ),
    /relay URI is malformed/i,
  );
  assert.throws(
    () =>
      signGoogleCalendarCallbackRelayUri(
        `${canonicalRelay}&unexpected=drop-me`,
        canonicalCallback,
        secret,
      ),
    /relay URI is malformed/i,
  );
  assert.throws(
    () =>
      signGoogleCalendarCallbackRelayUri(
        canonicalRelay.replace("https://", "https://user:pass@"),
        canonicalCallback,
        secret,
      ),
    /relay URI is malformed/i,
  );
});

test("OAuth start and token exchange share the dedicated redirect setting", () => {
  const resolverCall =
    /googleCalendarRedirectUri\(\s*appUrl,\s*process\.env\.GOOGLE_CALENDAR_REDIRECT_URI,?\s*\)/;
  assert.match(integrationActionsSource, resolverCall);
  assert.match(googleCallbackSource, resolverCall);
});

test("OAuth kickoff canonicalizes before setting its state cookie", () => {
  const hostDecisionIndex = integrationActionsSource.indexOf(
    "googleCalendarCanonicalConnectPageUri(",
  );
  const stateCookieIndex = integrationActionsSource.indexOf(
    "cookieStore.set(GOOGLE_STATE_COOKIE",
  );
  assert.ok(hostDecisionIndex >= 0 && stateCookieIndex > hostDecisionIndex);
  assert.match(
    integrationsPageSource,
    /Tap\s+the\s+Google\s+Calendar\s+button\s+again\s+to\s+continue/i,
  );
});

test("OAuth callback relay runs before host-scoped admin authentication", () => {
  const relayIndex = googleCallbackSource.indexOf(
    "googleCalendarCallbackRelayUri(",
  );
  const adminIndex = googleCallbackSource.indexOf("await requireAdmin()");
  assert.ok(relayIndex >= 0 && adminIndex > relayIndex);
  assert.match(
    googleCallbackSource,
    /NextResponse\.redirect\(signedRelayUri, 303\)/,
  );
  assert.match(googleCallbackSource, /"Cache-Control", "no-store"/);
  assert.match(googleCallbackSource, /"Referrer-Policy", "no-referrer"/);
});

test("signed callback hop is verified before relay and authentication", () => {
  const secretIndex = googleCallbackSource.indexOf(
    "const clientSecret = process.env.GOOGLE_CLIENT_SECRET",
  );
  const verificationIndex = googleCallbackSource.indexOf(
    "googleCalendarCallbackRelayIsVerified(",
  );
  const relayIndex = googleCallbackSource.indexOf(
    "googleCalendarCallbackRelayUri(",
  );
  const adminIndex = googleCallbackSource.indexOf("await requireAdmin()");
  assert.ok(
    secretIndex >= 0 &&
      verificationIndex > secretIndex &&
      relayIndex > verificationIndex &&
      adminIndex > relayIndex,
  );
  assert.match(
    googleCallbackSource,
    /!verifiedRelayHop\s*&&\s*googleCalendarCallbackHasRelayControls\(request\.url\)/,
  );
  assert.match(
    googleCallbackSource,
    /signGoogleCalendarCallbackRelayUri\(\s*relayUri,\s*canonicalCallbackUri,\s*clientSecret,?\s*\)/,
  );
  assert.match(
    googleCallbackSource,
    /new URL\(\s*"\/admin\/settings\/integrations",\s*canonicalCallbackUri,?\s*\)/,
  );
});

test("callback configuration errors are classified before origin errors", () => {
  const configIndex = googleCallbackSource.indexOf(
    "redirectUri = googleCalendarRedirectUri(",
  );
  const config500Index = googleCallbackSource.indexOf(
    "{ status: 500 }",
    configIndex,
  );
  const relayIndex = googleCallbackSource.indexOf(
    "googleCalendarCallbackRelayUri(",
  );
  const origin400Index = googleCallbackSource.indexOf(
    "{ status: 400 }",
    relayIndex,
  );
  assert.ok(
    configIndex >= 0 &&
      config500Index > configIndex &&
      relayIndex > config500Index &&
      origin400Index > relayIndex,
  );
});

test("OAuth error callbacks validate and burn state before returning", () => {
  const stateValidationIndex = googleCallbackSource.indexOf(
    "expectedState !== state",
  );
  const burnStateIndex = googleCallbackSource.indexOf(
    "cookieStore.delete(STATE_COOKIE)",
  );
  const errorIndex = googleCallbackSource.indexOf("if (errorParam)");
  assert.ok(
    stateValidationIndex >= 0 &&
      burnStateIndex > stateValidationIndex &&
      errorIndex > burnStateIndex,
  );
});

test("OAuth callback stays bound to the initiating admin and organization", () => {
  assert.match(
    integrationActionsSource,
    /buildGoogleCalendarOAuthState\(\s*admin\.userId,\s*admin\.organizationId,?\s*\)/,
  );
  const bindingIndex = googleCallbackSource.indexOf(
    "googleCalendarOAuthStateMatchesAdmin(",
  );
  const exchangeIndex = googleCallbackSource.indexOf(
    "await exchangeCodeForTokens(",
  );
  assert.ok(bindingIndex >= 0 && exchangeIndex > bindingIndex);
  assert.match(googleCallbackSource, /state_context_mismatch/);
  assert.match(
    integrationsPageSource,
    /signed-in\s+admin\s+changed\s+during\s+Google\s+consent/i,
  );
});

test("Google diagnostics and setup display the normalized redirect URI", () => {
  assert.match(
    integrationsPageSource,
    /googleCalendarRedirectUri\(\s*appUrl,\s*process\.env\.GOOGLE_CALENDAR_REDIRECT_URI,?\s*\)/,
  );
  assert.equal(
    integrationsPageSource.match(/\{resolvedGoogleRedirectUri\}/g)?.length,
    2,
  );
});

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
