import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const [
  bridge,
  cookieWriter,
  serverSupabase,
  requireAdmin,
  requireUser,
  currentUser,
  recommendation,
  bookingAction,
  confirmationPage,
  passwordAction,
] = await Promise.all([
  read("app/api/auth/bridge/route.ts"),
  read("lib/auth/set-session-cookie.ts"),
  read("lib/supabase/server.ts"),
  read("lib/auth/require-admin.ts"),
  read("lib/auth/require-user.ts"),
  read("lib/auth/current-user.ts"),
  read("app/book/recommendation-actions.ts"),
  read("app/book/actions.ts"),
  read("app/book/confirm/page.tsx"),
  read("app/auth/password/actions.ts"),
]);

test("the public auth bridge verifies and binds the token pair before installing cookies", () => {
  assert.match(bridge, /requireVerifiedAccessToken/);
  assert.match(bridge, /supabase\.auth\.getUser\(token\)/);
  assert.match(bridge, /exchangeSupabaseRefreshToken/);
  assert.match(bridge, /setSupabaseSessionCookie/);
  assert.doesNotMatch(bridge, /Buffer\.from\([^\n]*base64url/);
  assert.doesNotMatch(bridge, /access_token\.split\("\\\."\)/);

  const verifyIndex = bridge.indexOf(
    "verifiedUser = await requireVerifiedAccessToken",
  );
  const exchangeIndex = bridge.indexOf(
    "await exchangeSupabaseRefreshToken",
  );
  const cookieIndex = bridge.indexOf("await setSupabaseSessionCookie");
  assert.ok(
    verifyIndex >= 0 &&
      verifyIndex < exchangeIndex &&
      exchangeIndex < cookieIndex,
  );
});

test("session cookie installation is bound to the verified Supabase user", () => {
  assert.match(cookieWriter, /requireVerifiedAccessToken/);
  assert.match(cookieWriter, /auth\.getUser\(accessToken\)/);
  assert.match(cookieWriter, /parseVerifiedAccessTokenClaims/);
  assert.match(cookieWriter, /verifiedUser\.id/);
});

test("every server Auth verifier uses the bounded Supabase fetch", () => {
  assert.match(serverSupabase, /createBoundedSupabaseAuthFetch/);
  assert.match(serverSupabase, /global:\s*{\s*fetch:/);
});

test("server identity decisions no longer trust locally decoded JWT claims", () => {
  for (const [name, source] of [
    ["require-admin", requireAdmin],
    ["require-user", requireUser],
    ["current-user", currentUser],
    ["recommendation", recommendation],
    ["booking-action", bookingAction],
    ["confirmation-page", confirmationPage],
  ]) {
    assert.match(source, /auth\.getUser\(/, `${name} must call auth.getUser`);
    assert.doesNotMatch(source, /auth\.getSession\(/, `${name} must not trust getSession`);
    assert.doesNotMatch(source, /decodeUserId/, `${name} must not decode identity locally`);
  }
});

test("public booking does not downgrade verifier outages to anonymous access", () => {
  assert.match(bookingAction, /error: sessionUserError/);
  assert.match(
    bookingAction,
    /sessionUserError && !isMissingSessionError\(sessionUserError\)/,
  );
  assert.match(bookingAction, /error: sessionProfileError/);
  assert.match(bookingAction, /if \(!profile\)/);
  assert.match(bookingAction, /return authResolutionUnavailable\(\)/);
});

test("password-grant success bodies are byte-bounded before JSON parsing", () => {
  assert.match(cookieWriter, /MAX_PROVIDER_RESPONSE_BYTES/);
  assert.match(cookieWriter, /readBoundedProviderJson/);
  assert.doesNotMatch(cookieWriter, /await res\.json\(\)/);
  assert.doesNotMatch(cookieWriter, /await reader\.cancel\(\)/);
});

test("password sign-in uses the same verified cookie installer", () => {
  assert.match(passwordAction, /setSupabaseSessionCookie/);
  assert.doesNotMatch(passwordAction, /Buffer\.from\([^\n]*base64url/);
  assert.doesNotMatch(passwordAction, /cookieStore\.set\(/);
});
