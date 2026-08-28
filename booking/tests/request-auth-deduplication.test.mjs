import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const identityModule = await tsImport(
  "../lib/auth/request-verified-identity-core.ts",
  import.meta.url,
);
const { resolveVerifiedIdentity } = identityModule.default;

const [
  requestIdentity,
  requestIdentityCore,
  serverSupabase,
  currentUser,
  requireAdmin,
  requireUser,
  requirePlatformAdmin,
  rootLayout,
  adminLayout,
  adminTodayPage,
  packageJson,
  ciWorkflow,
  authenticatedHttpProbe,
  refreshRoute,
] = await Promise.all([
  read("lib/auth/request-verified-identity.ts"),
  read("lib/auth/request-verified-identity-core.ts"),
  read("lib/supabase/server.ts"),
  read("lib/auth/current-user.ts"),
  read("lib/auth/require-admin.ts"),
  read("lib/auth/require-user.ts"),
  read("lib/auth/require-platform-admin.ts"),
  read("app/layout.tsx"),
  read("app/admin/layout.tsx"),
  read("app/admin/today/page.tsx"),
  read("package.json"),
  read("../.github/workflows/ci.yml"),
  read("scripts/verify-auth-request-deduplication-http.mjs"),
  read("app/auth/refresh/route.ts"),
]);

test("malformed successful identity IDs fail closed", async () => {
  for (const id of [
    "",
    " ",
    " user-id",
    "user-id ",
    "user-id",
    "00000000-0000-0000-0000-000000000000",
    7,
    true,
    [],
    {},
  ]) {
    const result = await resolveVerifiedIdentity(async () => ({
      data: { user: { id } },
      error: null,
    }));
    assert.deepEqual(result, { kind: "invalid" });
  }

  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.invalid",
  };
  assert.deepEqual(
    await resolveVerifiedIdentity(async () => ({
      data: { user },
      error: null,
    })),
    { kind: "authenticated", user },
  );
});

test("the built authenticated composition probe is a required CI gate", () => {
  assert.match(packageJson, /"test:http-auth-dedup"/);
  assert.match(ciWorkflow, /npm run test:http-auth-dedup/);
  assert.match(ciWorkflow, /NEXT_PUBLIC_SUPABASE_URL: http:\/\/127\.0\.0\.1:54329/);
  assert.match(authenticatedHttpProbe, /fresh_protected_request/);
  assert.match(authenticatedHttpProbe, /persisted_refresh/);
  assert.match(authenticatedHttpProbe, /followUpRefreshes: 0/);
  assert.match(authenticatedHttpProbe, /public_rsc_near_expiry/);
  assert.match(authenticatedHttpProbe, /server_action_and_rsc_revalidation/);
  assert.match(authenticatedHttpProbe, /server_action_concurrent_refresh_race/);
  assert.match(authenticatedHttpProbe, /platform_route/);
  assert.match(authenticatedHttpProbe, /same_session_concurrent_refresh_race/);
  assert.match(authenticatedHttpProbe, /refresh_destination_containment/);
  assert.match(authenticatedHttpProbe, /concurrent_isolation/);
  assert.match(authenticatedHttpProbe, /missing_cookie/);
  assert.match(authenticatedHttpProbe, /fresh_invalid_session/);
  assert.match(authenticatedHttpProbe, /malformed_local_cookie/);
  assert.match(authenticatedHttpProbe, /request_timeout/);
  assert.match(authenticatedHttpProbe, /rate_limited/);
  assert.match(authenticatedHttpProbe, /server_unavailable/);
  assert.match(authenticatedHttpProbe, /AUTH_ERROR_BODY_SENTINEL/);
  assert.match(authenticatedHttpProbe, /assertNoServiceRoleAfterAuthFailure/);
  assert.match(authenticatedHttpProbe, /exactRefreshProofCount/);
});

test("identity-failure oracles forbid protected page-data work", () => {
  assert.match(authenticatedHttpProbe, /const protectedWorkFailureProofs = \{\};/);
  assert.match(authenticatedHttpProbe, /function assertNoProtectedWorkAfterAuthFailure/);
  assert.match(authenticatedHttpProbe, /delta\.todayPageBookings/);
  assert.match(
    authenticatedHttpProbe,
    /assertNoProtectedWorkAfterAuthFailure\(delta, scenarioMode\)/,
  );
  assert.match(authenticatedHttpProbe, /protectedWorkFailureProofs,/);
});

test("refresh handoff owns one direct token exchange without SDK refresh re-entry", () => {
  assert.match(
    refreshRoute,
    /\/auth\/v1\/token\?grant_type=refresh_token/,
    "the mutable refresh boundary must own the one refresh-token request",
  );
  assert.doesNotMatch(
    refreshRoute,
    /\.auth\.refreshSession\(/,
    "SDK refreshSession can implicitly refresh while loading and then rotate again",
  );
  assert.doesNotMatch(
    refreshRoute,
    /\$\{supabaseUrl\}\/auth\/v1\/user|requireVerifiedAccessToken/,
    "the refresh boundary must not duplicate the destination's authoritative identity request",
  );
  assert.match(refreshRoute, /validatedSession\(await tokenResponse\.json\(\)\)/);
  assert.match(refreshRoute, /parseVerifiedAccessTokenClaims/);
  assert.match(
    refreshRoute,
    /destination performs the one required authoritative \/auth\/v1\/user request/,
  );
});

test("successful refresh writes retain the production Secure cookie policy", () => {
  const securePolicy = /secure:\s*process\.env\.NODE_ENV\s*===\s*"production"/g;
  assert.equal(
    (refreshRoute.match(securePolicy) ?? []).length,
    1,
    "the direct refresh route must mark replacement cookies Secure in production",
  );
  assert.equal(
    (serverSupabase.match(securePolicy) ?? []).length,
    1,
    "the shared server client must retain the production Secure policy",
  );
});

test("the shared server client applies the bounded SDK cookie adapter", () => {
  assert.match(serverSupabase, /cookies:\s*{\s*getAll\(\)/s);
  assert.match(serverSupabase, /getSupabaseSdkVisibleCookies\(/);
  assert.match(serverSupabase, /getSupabaseSdkCookieMutations\(/);
  assert.doesNotMatch(
    serverSupabase,
    /return cookieStore\.getAll\(\)/,
    "raw request cookies must not enter the SDK's broad chunk matcher",
  );
  assert.doesNotMatch(
    serverSupabase,
    /cookies:\s*{\s*get\(name:/s,
    "the deprecated adapter truncates large session chunk families",
  );
  assert.match(serverSupabase, /createSupabaseRefreshCookieTransaction\(/);
  assert.match(
    serverSupabase,
    /onRefreshTokenCandidate:\s*refreshTransaction\.acceptRefreshCandidate/,
  );
  assert.match(
    serverSupabase,
    /onAuthUserProof:\s*refreshTransaction\.processAuthUserProof/,
  );
  assert.match(
    serverSupabase,
    /refreshTransaction\.processCookieMutations\(safeMutations\)/,
  );
  assert.doesNotMatch(serverSupabase, /preserveSessionCookie/);
});

test("layouts and guards share the request identity boundary", () => {
  assert.match(requestIdentityCore, /cache\(/);
  assert.match(requestIdentity, /createRequestVerifiedIdentity/);
  assert.equal(
    (requestIdentity.match(/auth\.getUser\(/g) ?? []).length,
    1,
    "the request identity boundary must own the only helper-level getUser call",
  );

  assert.match(currentUser, /getRequestVerifiedIdentity/);
  assert.match(
    currentUser,
    /export const getCurrentUserResult = cache\(/,
    "profile resolution must be request-scoped",
  );
  assert.match(requireAdmin, /getCurrentUserResult/);
  assert.match(requireAdmin, /export const requireAdmin = cache\(/);
  assert.match(requireUser, /getCurrentUserResult/);
  assert.match(currentUser, /verifiedIdentity: Object\.freeze/);
  assert.match(requireAdmin, /verifiedIdentity: current\.verifiedIdentity/);
  assert.doesNotMatch(requirePlatformAdmin, /getRequestVerifiedIdentity/);
  assert.match(requirePlatformAdmin, /user: admin\.verifiedIdentity/);
  assert.match(
    serverSupabase,
    /export const getServerSupabase = cache\(/,
    "all RSC Supabase consumers must share one refreshed request client",
  );
  assert.match(rootLayout, /getCurrentUser\(/);
  assert.match(adminLayout, /requireAdmin\(/);
  assert.match(adminTodayPage, /requireAdmin\(/);

  for (const [name, source] of [
    ["current-user", currentUser],
    ["require-admin", requireAdmin],
    ["require-user", requireUser],
    ["require-platform-admin", requirePlatformAdmin],
  ]) {
    assert.doesNotMatch(
      source,
      /auth\.getUser\(/,
      `${name} must consume the shared authoritative result`,
    );
    assert.doesNotMatch(source, /auth\.getSession\(/);
    assert.doesNotMatch(source, /decodeUserId/);
  }
});
