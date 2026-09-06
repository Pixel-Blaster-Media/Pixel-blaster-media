import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";

const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
assert.equal(
  supabaseUrl.protocol,
  "http:",
  "the authenticated HTTP probe refuses non-HTTP Supabase targets",
);
assert.ok(
  supabaseUrl.hostname === "127.0.0.1" || supabaseUrl.hostname === "localhost",
  "the authenticated HTTP probe refuses non-loopback Supabase targets",
);
const fakePort = Number(supabaseUrl.port);
assert.ok(Number.isInteger(fakePort) && fakePort > 0);
assert.ok(existsSync(".next/BUILD_ID"), "run a production build before this probe");

const CANONICAL_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://ci.example.invalid";
const CANONICAL_HOST = new URL(CANONICAL_URL).host;
const PRODUCTION_PROXY_HOST =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ??
  "pixel-blaster-media.vercel.app";
const PROXY_SECRET =
  process.env.BOOKING_PROXY_SHARED_SECRET ??
  "ci-only-proxy-attestation-secret-0123456789abcdef";
const AUTH_ERROR_BODY_SENTINEL = "SENTINEL_AUTH_RESPONSE_BODY_MUST_NOT_LEAK";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
assert.ok(SERVICE_ROLE_KEY, "the authenticated HTTP probe requires a synthetic service-role key");

const appPort = await reservePort();
const nowSeconds = Math.floor(Date.now() / 1000);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const actors = {
  primary: {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "21111111-1111-4111-8111-111111111111",
    email: "platform-owner@example.invalid",
    profileRole: "admin",
    membershipRole: "owner",
  },
  secondary: {
    id: "12222222-2222-4222-8222-222222222222",
    organizationId: "22222222-2222-4222-8222-222222222222",
    email: "secondary-admin@example.invalid",
    profileRole: "admin",
    membershipRole: "owner",
  },
};
const actorEntries = Object.entries(actors);
const actorById = new Map(actorEntries.map(([, actor]) => [actor.id, actor]));

const counts = {
  refresh: 0,
  authUser: 0,
  profiles: 0,
  memberships: 0,
  serviceRole: 0,
  todayPageBookings: 0,
};
const events = {
  refreshActors: [],
  authUserIds: [],
  profileUserIds: [],
  membershipUserIds: [],
};
const serviceRoleFailureProofs = {};
const protectedWorkFailureProofs = {};
let mode = "valid";
const consumedSyntheticRefreshTokens = new Set();
const pendingRefreshProofTokensByActor = new Map();
let exactRefreshProofCount = 0;

const fakeSupabase = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", supabaseUrl.origin);
    const credential = requestCredential(request);
    if (credential.kind === "service_role") counts.serviceRole += 1;

    if (url.pathname === "/auth/v1/token") {
      counts.refresh += 1;
      const body = await readBody(request);
      const refreshToken = parseRefreshToken(body);
      const actorKey = refreshToken.split(":")[1];
      const actor = actors[actorKey];
      assert.ok(actor, `unknown synthetic refresh actor: ${actorKey}`);
      events.refreshActors.push(actorKey);
      if (mode === "rotating_refresh") {
        if (consumedSyntheticRefreshTokens.has(refreshToken)) {
          return json(response, 400, {
            code: "refresh_token_not_found",
            message: "Refresh token already rotated",
          });
        }
        consumedSyntheticRefreshTokens.add(refreshToken);
      }
      return refreshSessionJson(response, refreshedSession(actor, actorKey));
    }

    if (url.pathname === "/auth/v1/user") {
      counts.authUser += 1;
      const bearer = bearerToken(request.headers.authorization);
      const actor = actorFromAuthorization(request.headers.authorization);
      events.authUserIds.push(actor?.id ?? null);
      if (actor) {
        const pendingTokens = pendingRefreshProofTokensByActor.get(actor.id);
        if (pendingTokens?.size) {
          assert.ok(
            bearer && pendingTokens.has(bearer),
            "the first post-refresh identity proof must use the exact access-token bytes returned by that exchange",
          );
          pendingTokens.delete(bearer);
          exactRefreshProofCount += 1;
          if (pendingTokens.size === 0) {
            pendingRefreshProofTokensByActor.delete(actor.id);
          }
        }
      }
      if (mode === "invalid") {
        return json(response, 401, {
          code: "bad_jwt",
          message: AUTH_ERROR_BODY_SENTINEL,
          secret: AUTH_ERROR_BODY_SENTINEL,
        });
      }
      if (mode === "request_timeout") {
        return json(response, 408, {
          code: "request_timeout",
          message: "Request timed out",
        });
      }
      if (mode === "rate_limited") {
        return json(response, 429, {
          code: "over_request_rate_limit",
          message: "Too many requests",
        });
      }
      if (mode === "too_early") {
        return json(response, 425, {
          code: "too_early",
          message: AUTH_ERROR_BODY_SENTINEL,
        });
      }
      if (mode === "server_unavailable") {
        return json(response, 503, {
          code: "service_unavailable",
          message: "Unavailable",
        });
      }
      assert.ok(actor, "the refreshed access token must identify an actor");
      if (mode === "malformed_success_body") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(`{"id":"${AUTH_ERROR_BODY_SENTINEL}`);
        return;
      }
      if (mode === "malformed_user") {
        return json(response, 200, { ...authUser(actor), id: "" });
      }
      return json(response, 200, authUser(actor));
    }

    const restMatch = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
    if (!restMatch) return json(response, 404, { error: "not found" });

    const table = restMatch[1];
    if (table === "profiles") {
      counts.profiles += 1;
      const actor = actorFromFilter(url.searchParams.get("id"));
      events.profileUserIds.push(actor?.id ?? null);
      assert.equal(
        credential.kind,
        "user",
        "profile lookup must carry the verified user bearer",
      );
      assert.equal(
        credential.actor.id,
        actor?.id,
        "profile filter must equal the bearer subject",
      );
      assert.ok(actor, "profile query must be scoped to the verified user");
      return json(response, 200, {
        id: actor.id,
        organization_id: actor.organizationId,
        email: actor.email,
        full_name: "Runtime Probe",
        phone: null,
        profile_photo_url: null,
        role: actor.profileRole,
        archived_at: null,
      });
    }

    if (table === "organization_members") {
      counts.memberships += 1;
      const actor = actorFromFilter(url.searchParams.get("profile_id"));
      const requestedOrganizationId = filterValue(
        url.searchParams.get("organization_id"),
      );
      events.membershipUserIds.push(actor?.id ?? null);
      assert.equal(
        credential.kind,
        "user",
        "membership lookup must carry the verified user bearer",
      );
      assert.equal(
        credential.actor.id,
        actor?.id,
        "membership profile filter must equal the bearer subject",
      );
      assert.equal(
        requestedOrganizationId,
        credential.actor.organizationId,
        "membership organization filter must equal the bearer tenant",
      );
      assert.ok(actor, "membership query must be scoped to the verified user");
      assert.equal(
        requestedOrganizationId,
        actor.organizationId,
        "membership query must include the verified profile organization filter",
      );
      if (!actor.membershipRole) return json(response, 200, null);
      return json(response, 200, {
        organization_id: actor.organizationId,
        role: actor.membershipRole,
      });
    }

    if (table === "organizations") {
      assert.equal(
        credential.kind,
        "service_role",
        "modeled organization inventory must use the service-role client",
      );
      const select = url.searchParams.get("select") ?? "";
      if (select.includes("lifecycle_status")) return json(response, 200, []);
      return json(response, 200, {
        id: actors.primary.organizationId,
        name: "Runtime Probe Organization",
        slug: "runtime-probe",
        primary_color: null,
        accent_color: null,
        logo_url: null,
        booking_hero_image_url: null,
        booking_hero_secondary_image_url: null,
      });
    }

    if (table === "bookings") {
      const select = url.searchParams.get("select") ?? "";
      const requestedOrganizationId = filterValue(
        url.searchParams.get("organization_id"),
      );
      if (credential.kind === "user") {
        assert.equal(
          requestedOrganizationId,
          credential.actor.organizationId,
          "booking query tenant must equal the user bearer tenant",
        );
      } else {
        assert.equal(
          credential.kind,
          "service_role",
          "booking requests must use an authenticated modeled client",
        );
        assert.equal(
          requestedOrganizationId,
          actors.primary.organizationId,
          "service-role booking action must remain in the verified admin tenant",
        );
      }
      const scheduledAtFilters = url.searchParams.getAll("scheduled_at");
      const todayPageQuery =
        request.method === "GET" &&
        select.includes("scheduled_at") &&
        select.includes("scheduled_ends_at") &&
        scheduledAtFilters.some((value) => value.startsWith("gte.")) &&
        scheduledAtFilters.some((value) => value.startsWith("lt."));
      if (todayPageQuery) {
        assert.equal(
          credential.kind,
          "user",
          "Today page bookings must use the verified user client",
        );
        counts.todayPageBookings += 1;
        return json(response, 200, []);
      }
      assert.equal(
        mode,
        "server_action_revalidate",
        "non-Today booking requests are only modeled in the action scenario",
      );
      assert.equal(credential.kind, "service_role");
      assert.equal(
        url.searchParams.get("organization_id"),
        `eq.${actors.primary.organizationId}`,
      );
      assert.equal(
        url.searchParams.get("id"),
        "eq.31111111-1111-4111-8111-111111111111",
      );
      if (request.method === "GET" && select === "id,status") {
        return json(response, 200, {
          id: "31111111-1111-4111-8111-111111111111",
          status: "confirmed",
        });
      }
      if (request.method === "GET" && select === "status,lifecycle_version") {
        return json(response, 200, { status: "confirmed", lifecycle_version: 7 });
      }
      if (request.method === "PATCH") {
        // Model the status action's CAS and affected-row representation, not
        // the old unconditional update whose empty result meant success.
        assert.equal(select, "id");
        assert.equal(url.searchParams.get("status"), "eq.confirmed");
        assert.equal(url.searchParams.get("lifecycle_version"), "eq.7");
        assert.deepEqual(JSON.parse(await readBody(request)), { status: "shot" });
        assert.ok(
          String(request.headers.prefer).split(",").includes("return=representation"),
        );
        return json(response, 200, [{
          id: "31111111-1111-4111-8111-111111111111",
        }]);
      }
      if (request.method === "GET" && select === "id") {
        return json(response, 200, {
          id: "31111111-1111-4111-8111-111111111111",
        });
      }
      return json(response, 400, {
        error: `unexpected bookings query in action probe: ${select}`,
      });
    }

    if (table === "beta_company_invites") {
      assert.equal(
        credential.kind,
        "service_role",
        "beta invitation inventory must use the service-role client",
      );
      assert.equal(request.method, "GET");
      return json(response, 200, []);
    }

    if (table === "assistant_action_logs") {
      assert.equal(
        credential.kind,
        "service_role",
        "assistant audit writes must use the service-role client",
      );
      assert.equal(request.method, "POST");
      const payload = JSON.parse(await readBody(request));
      assert.equal(payload.organization_id, actors.primary.organizationId);
      return json(response, 200, []);
    }

    assert.fail(
      `unmodeled post-auth REST request: ${request.method} ${url.pathname}${url.search}`,
    );
  } catch (error) {
    return json(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
await listen(fakeSupabase, fakePort);

const oracleMutationProofs = {};
for (const mutation of [
  {
    name: "cross-user profile bearer",
    path: `/rest/v1/profiles?select=id&id=eq.${actors.secondary.id}`,
    authorization: `Bearer ${jwt(actors.primary, nowSeconds + 3_600, "oracle-profile")}`,
  },
  {
    name: "cross-organization membership filter",
    path: `/rest/v1/organization_members?select=organization_id,role&profile_id=eq.${actors.primary.id}&organization_id=eq.${actors.secondary.organizationId}`,
    authorization: `Bearer ${jwt(actors.primary, nowSeconds + 3_600, "oracle-membership")}`,
  },
  {
    name: "unknown user REST request",
    path: "/rest/v1/unmodeled_sensitive_table?select=*",
    authorization: `Bearer ${jwt(actors.primary, nowSeconds + 3_600, "oracle-unknown-user")}`,
  },
  {
    name: "unknown service-role REST request",
    path: "/rest/v1/unmodeled_sensitive_table?select=*",
    apikey: SERVICE_ROLE_KEY,
    authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  },
]) {
  const mutationResponse = await fakeSupabaseRequest(mutation);
  assert.equal(
    mutationResponse.status,
    500,
    `the fake Supabase oracle must reject ${mutation.name}`,
  );
  oracleMutationProofs[mutation.name] = mutationResponse.status;
}

assert.throws(
  () =>
    assertRedirect(
      {
        status: 200,
        headers: {},
        body: "NEXT_REDIRECT;replace;/auth/sign-in-attacker-controlled;307;",
      },
      "/auth/sign-in",
    ),
  /redirect target did not equal/,
  "redirect assertions must reject a body that merely contains the expected path as a prefix",
);

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(appPort)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_URL: CANONICAL_URL,
      VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_PROXY_HOST,
      BOOKING_PROXY_SHARED_SECRET: PROXY_SECRET,
      PLATFORM_ADMIN_EMAILS: actors.primary.email,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let childOutput = "";
child.stdout.on("data", (chunk) => {
  childOutput = `${childOutput}${String(chunk)}`.slice(-20_000);
});
child.stderr.on("data", (chunk) => {
  childOutput = `${childOutput}${String(chunk)}`.slice(-20_000);
});

const scenarios = {};
try {
  await waitForApp();

  mode = "valid";
  const beforeFreshProtected = snapshot();
  const freshProtected = await browserRequest({
    cookieJar: cookieJarFromHeader(freshAuthCookie("primary")),
  });
  assert.equal(freshProtected.response.status, 200);
  assert.match(freshProtected.response.body, /No shoots scheduled today\./);
  assert.deepEqual(scalarCounts(difference(beforeFreshProtected)), {
    refresh: 0,
    authUser: 1,
    profiles: 1,
    memberships: 1,
  });
  assert.equal(freshProtected.setCookieCount, 0);
  scenarios.fresh_protected_request = {
    refresh: 0,
    authUser: 1,
    profiles: 1,
    memberships: 1,
  };

  const publicNearExpiryJar = cookieJarFromHeader(
    nearExpiryAuthCookie("primary", 75),
  );
  const publicNearExpiryCookieBefore = cookieHeaderFromJar(publicNearExpiryJar);
  const beforePublicNearExpiry = snapshot();
  const publicNearExpiry = await browserRequest({
    cookieJar: publicNearExpiryJar,
    path: "/",
  });
  assert.equal(publicNearExpiry.response.status, 200);
  assert.deepEqual(scalarCounts(difference(beforePublicNearExpiry)), {
    refresh: 0,
    authUser: 0,
    profiles: 0,
    memberships: 0,
  });
  assert.equal(
    publicNearExpiry.setCookieCount,
    0,
    "a read-only public RSC must not attempt an unpersistable session rotation",
  );
  assert.equal(
    cookieHeaderFromJar(publicNearExpiry.cookieJar),
    publicNearExpiryCookieBefore,
    "a read-only public RSC must preserve the browser's near-expiry session exactly",
  );
  scenarios.public_rsc_near_expiry = {
    refresh: 0,
    authUser: 0,
    cookiesPreserved: true,
  };
  const beforePersistence = snapshot();
  const persistedSession = await browserRequest({ actorKey: "primary" });
  assert.equal(persistedSession.response.status, 200);
  assert.ok(
    persistedSession.setCookieCount > 0,
    "an expired protected session must persist its rotated cookie before rendering",
  );
  const persistedDelta = difference(beforePersistence);
  assert.deepEqual(scalarCounts(persistedDelta), {
    refresh: 1,
    authUser: 1,
    profiles: 1,
    memberships: 1,
  });

  const beforePersistedFollowUp = snapshot();
  const persistedFollowUp = await browserRequest({
    cookieJar: persistedSession.cookieJar,
    path: "/admin/today",
  });
  assert.equal(persistedFollowUp.response.status, 200);
  assert.deepEqual(scalarCounts(difference(beforePersistedFollowUp)), {
    refresh: 0,
    authUser: 1,
    profiles: 1,
    memberships: 1,
  });
  scenarios.persisted_refresh = {
    counts: scalarCounts(persistedDelta),
    initialRedirects: persistedSession.redirects,
    initialSetCookies: persistedSession.setCookieCount,
    followUpRefreshes: 0,
  };
  const actionManifest = JSON.parse(
    readFileSync(".next/server/server-reference-manifest.json", "utf8"),
  );
  const actionEntry = Object.entries(actionManifest.node).find(
    ([, entry]) => entry.exportedName === "confirmAdminAssistantAction",
  );
  assert.ok(actionEntry, "built assistant action must be present");
  const [assistantActionId] = actionEntry;
  mode = "server_action_revalidate";
  const actionBody = JSON.stringify([
    {
      type: "update_booking_status",
      bookingId: "31111111-1111-4111-8111-111111111111",
      nextStatus: "shot",
      label: "Move synthetic booking to shot",
      details: "Production action and revalidation protocol probe",
      href: "/admin/today",
      destructive: false,
      requiresConfirmation: true,
    },
  ]);
  const assistantActionHeaders = {
    Accept: "text/x-component",
    "Content-Type": "text/plain;charset=UTF-8",
    "Next-Action": assistantActionId,
    "Next-Router-State-Tree": encodeURIComponent(
      JSON.stringify([
        "",
        {
          children: [
            "admin",
            {
              children: ["today", { children: ["__PAGE__", {}] }],
            },
          ],
        },
        "/admin/today",
        true,
      ]),
    ),
    "Next-Url": "/admin/today",
    Origin: CANONICAL_URL,
  };
  const beforeServerAction = snapshot();
  const serverActionResponse = await appRequest({
    actorKey: null,
    body: actionBody,
    cookieHeader: cookieHeaderFromJar(persistedSession.cookieJar),
    extraHeaders: assistantActionHeaders,
    method: "POST",
    path: "/admin/today",
  });
  const serverActionDelta = difference(beforeServerAction);
  assert.equal(serverActionResponse.status, 200);
  assert.match(
    String(serverActionResponse.headers["content-type"]),
    /^text\/x-component/,
  );
  assert.equal(serverActionResponse.headers["x-action-revalidated"], "1");
  assert.match(serverActionResponse.body, /Done\. I moved the booking to shot\./);
  assert.match(
    serverActionResponse.body,
    /No shoots scheduled today\./,
    "the action response must include the completed Today RSC revalidation payload",
  );
  assert.equal(
    serverActionDelta.todayPageBookings,
    1,
    "the action response must complete exactly one Today page-only bookings query",
  );
  assert.deepEqual(scalarCounts(serverActionDelta), {
    refresh: 0,
    authUser: 2,
    profiles: 2,
    memberships: 2,
  });
  scenarios.server_action_and_rsc_revalidation = scalarCounts(serverActionDelta);
  mode = "rotating_refresh";
  const racingActionCookie = nearExpiryAuthCookie(
    "primary",
    75,
    "action-race",
  );
  const beforeRacingActions = snapshot();
  const racingActionResponses = await Promise.all([
    appRequest({
      actorKey: null,
      body: actionBody,
      cookieHeader: racingActionCookie,
      extraHeaders: assistantActionHeaders,
      method: "POST",
      path: "/admin/today",
    }),
    appRequest({
      actorKey: null,
      body: actionBody,
      cookieHeader: racingActionCookie,
      extraHeaders: assistantActionHeaders,
      method: "POST",
      path: "/admin/today",
    }),
  ]);
  const racingActionWinner = racingActionResponses.find(
    (response) =>
      response.status === 200 && !response.headers["x-action-redirect"],
  );
  const racingActionLoser = racingActionResponses.find(
    (response) => response !== racingActionWinner,
  );
  assert.ok(racingActionWinner, "one racing Server Action must rotate successfully");
  assert.ok(racingActionLoser, "one racing Server Action must lose rotation");
  assertRedirect(racingActionLoser, "/auth/sign-in");

  const racingActionJar = cookieJarFromHeader(racingActionCookie);
  const winnerActionMutations = applySetCookies(
    racingActionJar,
    racingActionWinner.headers["set-cookie"],
  );
  assert.equal(
    winnerActionMutations > 0,
    true,
    "the winning Server Action must install its rotated cookie",
  );
  const rotatedActionCookie = cookieHeaderFromJar(racingActionJar);
  const loserActionMutations = applySetCookies(
    racingActionJar,
    racingActionLoser.headers["set-cookie"],
  );
  assert.equal(
    loserActionMutations,
    0,
    "the losing Server Action response must emit zero cookie mutations",
  );
  assert.equal(
    cookieHeaderFromJar(racingActionJar),
    rotatedActionCookie,
    "winner-first response application must preserve the rotated Server Action session",
  );
  const racingActionDelta = difference(beforeRacingActions);
  assert.deepEqual(scalarCounts(racingActionDelta), {
    refresh: 2,
    authUser: 2,
    profiles: 2,
    memberships: 2,
  });
  scenarios.server_action_concurrent_refresh_race = {
    counts: scalarCounts(racingActionDelta),
    loserCookieMutations: loserActionMutations,
    rotatedCookiePreserved: true,
  };
  mode = "valid";
  const beforePlatformRoute = snapshot();
  const platformRouteResponse = await appRequest({
    actorKey: null,
    cookieHeader: cookieHeaderFromJar(persistedSession.cookieJar),
    path: "/admin/settings/companies",
  });
  const platformRouteDelta = difference(beforePlatformRoute);
  assert.equal(platformRouteResponse.status, 200);
  assert.match(
    String(platformRouteResponse.headers["content-type"]),
    /^text\/html/,
  );
  assert.match(platformRouteResponse.body, /Platform owner only/);
  assert.deepEqual(scalarCounts(platformRouteDelta), {
    refresh: 0,
    authUser: 1,
    profiles: 1,
    memberships: 1,
  });
  scenarios.platform_route = scalarCounts(platformRouteDelta);
  mode = "rotating_refresh";
  consumedSyntheticRefreshTokens.clear();
  const sameSessionCookie = authCookie("primary");
  const sameSessionRefreshPath =
    "/auth/refresh?next=%2Fadmin%2Ftoday%3Fconcurrent%3D1";
  const beforeSameSessionRace = snapshot();
  const sameSessionRefreshResponses = await Promise.all([
    appRequest({
      actorKey: null,
      cookieHeader: sameSessionCookie,
      path: sameSessionRefreshPath,
    }),
    appRequest({
      actorKey: null,
      cookieHeader: sameSessionCookie,
      path: sameSessionRefreshPath,
    }),
  ]);
  const responseByDestination = new Map(
    sameSessionRefreshResponses.map((response) => {
      const location = new URL(
        response.headers.location,
        `http://127.0.0.1:${appPort}`,
      );
      return [location.pathname, { location, response }];
    }),
  );
  const successfulConcurrentRefresh = responseByDestination.get("/admin/today");
  const staleConcurrentRefresh = responseByDestination.get("/auth/sign-in");
  assert.ok(
    successfulConcurrentRefresh,
    "one same-session concurrent refresh must rotate successfully",
  );
  assert.ok(
    staleConcurrentRefresh,
    "the stale terminal response must fail closed at sign-in",
  );
  assertExactRedirect(
    staleConcurrentRefresh.response,
    "/auth/sign-in?audience=company&next=%2Fadmin%2Ftoday%3Fconcurrent%3D1",
  );
  assert.equal(
    staleConcurrentRefresh.response.headers["set-cookie"],
    undefined,
    "a stale terminal response must emit no Auth mutation that could overwrite a winner",
  );

  const winnerFirstJar = cookieJarFromHeader(sameSessionCookie);
  applySetCookies(
    winnerFirstJar,
    successfulConcurrentRefresh.response.headers["set-cookie"],
  );
  const rotatedConcurrentCookie = cookieHeaderFromJar(winnerFirstJar);
  assert.notEqual(rotatedConcurrentCookie, sameSessionCookie);
  applySetCookies(
    winnerFirstJar,
    staleConcurrentRefresh.response.headers["set-cookie"],
  );
  assert.equal(
    cookieHeaderFromJar(winnerFirstJar),
    rotatedConcurrentCookie,
    "winner-first response application must preserve the rotated cookie",
  );

  const loserFirstJar = cookieJarFromHeader(sameSessionCookie);
  applySetCookies(
    loserFirstJar,
    staleConcurrentRefresh.response.headers["set-cookie"],
  );
  applySetCookies(
    loserFirstJar,
    successfulConcurrentRefresh.response.headers["set-cookie"],
  );
  assert.equal(
    cookieHeaderFromJar(loserFirstJar),
    rotatedConcurrentCookie,
    "loser-first response application must converge on the rotated cookie",
  );

  const sharedConcurrentJar = winnerFirstJar;

  const settledConcurrentSession = await browserRequest({
    cookieJar: sharedConcurrentJar,
    path: "/admin/today?concurrent=1",
  });
  assert.equal(settledConcurrentSession.response.status, 200);
  assert.equal(settledConcurrentSession.setCookieCount, 0);
  const raceDelta = difference(beforeSameSessionRace);
  assert.deepEqual(scalarCounts(raceDelta), {
    refresh: 2,
    authUser: 1,
    profiles: 1,
    memberships: 1,
  });
  scenarios.same_session_concurrent_refresh_race = {
    counts: scalarCounts(raceDelta),
    staleDeletionSuppressed: true,
    rotatedCookiePreserved: true,
  };
  consumedSyntheticRefreshTokens.clear();
  mode = "valid";
  for (const requestedNext of [
    "//evil.example/escape",
    "/auth/refresh?next=/admin/today",
  ]) {
    const beforeUnsafeNext = snapshot();
    const unsafeNextResponse = await appRequest({
      actorKey: "primary",
      path: `/auth/refresh?next=${encodeURIComponent(requestedNext)}`,
    });
    assert.equal(unsafeNextResponse.status, 307);
    const location = new URL(
      unsafeNextResponse.headers.location,
      `http://127.0.0.1:${appPort}`,
    );
    assert.equal(location.pathname, "/admin");
    assert.equal(location.search, "");
    assert.equal(scalarCounts(difference(beforeUnsafeNext)).refresh, 1);
  }
  scenarios.refresh_destination_containment = {
    external: "/admin",
    recursive: "/admin",
  };
  mode = "valid";
  const beforeConcurrent = snapshot();
  const concurrentSessions = await Promise.all([
    browserRequest({ actorKey: "primary" }),
    browserRequest({ actorKey: "secondary" }),
  ]);
  const concurrent = concurrentSessions.map(({ response }) => response);
  for (const response of concurrent) assert.equal(response.status, 200);
  const concurrentDelta = difference(beforeConcurrent);
  assert.deepEqual(scalarCounts(concurrentDelta), {
    refresh: 2,
    authUser: 2,
    profiles: 2,
    memberships: 2,
  });
  assert.deepEqual(
    [...concurrentDelta.profileUserIds].sort(),
    [actors.primary.id, actors.secondary.id].sort(),
  );
  assert.deepEqual(
    [...concurrentDelta.membershipUserIds].sort(),
    [actors.primary.id, actors.secondary.id].sort(),
  );
  scenarios.concurrent_isolation = scalarCounts(concurrentDelta);
  const beforeMissingCookie = snapshot();
  const missingCookie = await appRequest({ actorKey: null });
  assertRedirect(missingCookie, "/auth/sign-in");
  const missingCookieDelta = difference(beforeMissingCookie);
  assert.deepEqual(scalarCounts(missingCookieDelta), {
    refresh: 0,
    authUser: 0,
    profiles: 0,
    memberships: 0,
  });
  assertNoProtectedWorkAfterAuthFailure(missingCookieDelta, "missing session");
  scenarios.missing_cookie = { target: "/auth/sign-in" };

  mode = "valid";
  const beforeMalformedCookie = snapshot();
  const malformedCookieJar = cookieJarFromHeader(
    `sb-${supabaseUrl.hostname.split(".")[0]}-auth-token=base64-!!!; app-preference=preserve`,
  );
  const malformedCookie = await browserRequest({
    cookieJar: malformedCookieJar,
  });
  const malformedCookieDelta = difference(beforeMalformedCookie);
  assert.deepEqual(scalarCounts(malformedCookieDelta), {
    refresh: 0,
    authUser: 0,
    profiles: 0,
    memberships: 0,
  });
  assertNoProtectedWorkAfterAuthFailure(malformedCookieDelta, "malformed local cookie");
  assertRedirect(malformedCookie.response, "/auth/sign-in");
  assert.ok(
    malformedCookie.steps.some((step) => step.path === "/auth/session-invalid"),
    "malformed local session proof must cross the cookie-clearing boundary",
  );
  assert.deepEqual(supabaseAuthCookieNames(malformedCookie.cookieJar), []);
  assert.equal(malformedCookie.cookieJar.get("app-preference"), "preserve");
  scenarios.malformed_local_cookie = {
    counts: scalarCounts(malformedCookieDelta),
    target: "/auth/sign-in",
    cookiesCleared: true,
  };
  mode = "invalid";
  const beforeFreshInvalid = snapshot();
  const freshInvalidJar = cookieJarFromHeader(
    `${chunkedAuthCookie(freshAuthCookie("primary"))}; sb-unrelated-auth-token=preserve; app-preference=preserve`,
  );
  const freshInvalid = await browserRequest({
    cookieJar: freshInvalidJar,
  });
  const freshInvalidDelta = difference(beforeFreshInvalid);
  assert.deepEqual(scalarCounts(freshInvalidDelta), {
    refresh: 0,
    authUser: 1,
    profiles: 0,
    memberships: 0,
  });
  assertNoProtectedWorkAfterAuthFailure(freshInvalidDelta, "terminal-invalid user");
  assertRedirect(freshInvalid.response, "/auth/sign-in");
  assert.ok(
    freshInvalid.steps.some((step) => step.path === "/auth/session-invalid"),
    "a fresh terminal-invalid session must pass through the cookie-mutable clear boundary",
  );
  assert.deepEqual(
    supabaseAuthCookieNames(freshInvalid.cookieJar),
    [],
    "a fresh terminal-invalid session must be absent from the resulting browser jar",
  );
  assert.equal(
    freshInvalid.cookieJar.get("sb-unrelated-auth-token"),
    "preserve",
    "terminal cleanup must not clear another Supabase project's cookie",
  );
  assert.equal(
    freshInvalid.cookieJar.get("app-preference"),
    "preserve",
    "terminal cleanup must not clear unrelated application cookies",
  );
  scenarios.fresh_invalid_session = {
    counts: scalarCounts(difference(beforeFreshInvalid)),
    target: "/auth/sign-in",
    cookiesCleared: true,
  };

  for (const [scenarioMode, target] of [
    ["malformed_user", "/auth/sign-in"],
    ["malformed_success_body", "/auth/access-unavailable"],
    ["request_timeout", "/auth/access-unavailable"],
    ["rate_limited", "/auth/access-unavailable"],
    ["too_early", "/auth/access-unavailable"],
    ["server_unavailable", "/auth/access-unavailable"],
  ]) {
    mode = scenarioMode;
    const before = snapshot();
    const browser = await browserRequest({ actorKey: "primary" });
    const response = browser.response;
    const delta = difference(before);
    assert.deepEqual(scalarCounts(delta), {
      refresh: 1,
      authUser: 1,
      profiles: 0,
      memberships: 0,
    });
    assertNoProtectedWorkAfterAuthFailure(delta, scenarioMode);
    assertRedirect(response, target);
    if (target === "/auth/access-unavailable") {
      assert.ok(
        supabaseAuthCookieNames(browser.cookieJar).length > 0,
        `${scenarioMode} must preserve potentially recoverable session cookies`,
      );
    } else {
      assert.deepEqual(
        supabaseAuthCookieNames(browser.cookieJar),
        [],
        `${scenarioMode} must clear terminal-invalid session cookies`,
      );
    }
    scenarios[scenarioMode] = {
      counts: scalarCounts(delta),
      target,
    };
  }
  assert.equal(
    childOutput.includes(AUTH_ERROR_BODY_SENTINEL),
    false,
    "no upstream Auth response body may reach application logs in any scenario",
  );
  assert.equal(
    pendingRefreshProofTokensByActor.size,
    0,
    "every successful refresh candidate must receive an exact-token identity proof",
  );
  assert.ok(exactRefreshProofCount > 0);
  process.stdout.write(
    `${JSON.stringify({
      passed: true,
      scenarios,
      exactRefreshProofCount,
      serviceRoleFailureProofs,
      protectedWorkFailureProofs,
      oracleMutationProofs,
    })}\n`,
  );
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  fakeSupabase.closeAllConnections?.();
  await new Promise((resolve) => fakeSupabase.close(resolve));
}

function authUser(actor) {
  const timestamp = new Date().toISOString();
  return {
    id: actor.id,
    aud: "authenticated",
    role: "authenticated",
    email: actor.email,
    email_confirmed_at: timestamp,
    phone: "",
    confirmed_at: timestamp,
    last_sign_in_at: timestamp,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: timestamp,
    updated_at: timestamp,
    is_anonymous: false,
  };
}

function jwt(actor, expiresAt, suffix) {
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    aud: "authenticated",
    exp: expiresAt,
    iat: nowSeconds - (suffix === "expired" ? 3_660 : 0),
    sub: actor.id,
    email: actor.email,
    role: "authenticated",
  })}.${suffix}-probe-signature`;
}

function expiredSession(actor, actorKey) {
  return {
    access_token: jwt(actor, nowSeconds - 60, "expired"),
    token_type: "bearer",
    expires_in: 3_600,
    expires_at: nowSeconds - 60,
    refresh_token: `probe:${actorKey}`,
    user: authUser(actor),
  };
}

function refreshedSession(actor, actorKey) {
  return {
    access_token: jwt(actor, nowSeconds + 3_600, "fresh"),
    token_type: "bearer",
    expires_in: 3_600,
    expires_at: nowSeconds + 3_600,
    refresh_token: `probe-refreshed:${actorKey}`,
    user: authUser(actor),
  };
}

function authCookie(actorKey) {
  const actor = actors[actorKey];
  assert.ok(actor, `unknown actor ${actorKey}`);
  const encoded = Buffer.from(
    JSON.stringify(expiredSession(actor, actorKey)),
  ).toString("base64url");
  const projectRef = supabaseUrl.hostname.split(".")[0];
  return `sb-${projectRef}-auth-token=base64-${encoded}`;
}

function freshAuthCookie(actorKey) {
  const actor = actors[actorKey];
  assert.ok(actor, `unknown actor ${actorKey}`);
  const encoded = Buffer.from(
    JSON.stringify(refreshedSession(actor, actorKey)),
  ).toString("base64url");
  const projectRef = supabaseUrl.hostname.split(".")[0];
  return `sb-${projectRef}-auth-token=base64-${encoded}`;
}

function chunkedAuthCookie(cookieHeader) {
  const separator = cookieHeader.indexOf("=");
  assert.ok(separator > 0, "auth cookie must contain a name and value");
  const name = cookieHeader.slice(0, separator);
  const value = cookieHeader.slice(separator + 1);
  const split = Math.floor(value.length / 2);
  assert.ok(split > 0 && split < value.length, "auth cookie must be splittable");
  return `${name}.0=${value.slice(0, split)}; ${name}.1=${value.slice(split)}`;
}

function nearExpiryAuthCookie(
  actorKey,
  remainingSeconds,
  refreshSuffix = "seed",
) {
  const actor = actors[actorKey];
  assert.ok(actor, `unknown actor ${actorKey}`);
  const expiresAt = Math.ceil(Date.now() / 1_000) + remainingSeconds;
  const encoded = Buffer.from(
    JSON.stringify({
      ...expiredSession(actor, actorKey),
      access_token: jwt(actor, expiresAt, "near-expiry"),
      refresh_token: `refresh:${actorKey}:${refreshSuffix}`,
      expires_at: expiresAt,
    }),
  ).toString("base64url");
  const projectRef = supabaseUrl.hostname.split(".")[0];
  return `sb-${projectRef}-auth-token=base64-${encoded}`;
}

function requestCredential(request) {
  const serviceRoleApiKey = request.headers.apikey === SERVICE_ROLE_KEY;
  const serviceRoleBearer =
    request.headers.authorization === `Bearer ${SERVICE_ROLE_KEY}`;
  assert.equal(
    serviceRoleApiKey,
    serviceRoleBearer,
    "service-role requests must carry the synthetic key in both credential headers",
  );
  if (serviceRoleApiKey) return { kind: "service_role" };

  const actor = actorFromAuthorization(request.headers.authorization);
  return actor ? { kind: "user", actor } : { kind: "anonymous" };
}

function bearerToken(value) {
  return typeof value === "string" && value.startsWith("Bearer ")
    ? value.slice("Bearer ".length)
    : null;
}

function actorFromAuthorization(value) {
  const token = bearerToken(value);
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return actorById.get(decoded.sub) ?? null;
  } catch {
    return null;
  }
}

function actorFromFilter(value) {
  if (typeof value !== "string" || !value.startsWith("eq.")) return null;
  return actorById.get(value.slice(3)) ?? null;
}

function filterValue(value) {
  return typeof value === "string" && value.startsWith("eq.")
    ? value.slice(3)
    : null;
}

function parseRefreshToken(body) {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.refresh_token === "string") return parsed.refresh_token;
  } catch {}
  const parsed = new URLSearchParams(body).get("refresh_token");
  assert.ok(parsed, "refresh request must carry a refresh token");
  return parsed;
}

function snapshot() {
  return {
    ...counts,
    refreshActors: events.refreshActors.length,
    authUserIds: events.authUserIds.length,
    profileUserIds: events.profileUserIds.length,
    membershipUserIds: events.membershipUserIds.length,
  };
}

function difference(before) {
  return {
    refresh: counts.refresh - before.refresh,
    authUser: counts.authUser - before.authUser,
    profiles: counts.profiles - before.profiles,
    memberships: counts.memberships - before.memberships,
    serviceRole: counts.serviceRole - before.serviceRole,
    todayPageBookings: counts.todayPageBookings - before.todayPageBookings,
    refreshActors: events.refreshActors.slice(before.refreshActors),
    authUserIds: events.authUserIds.slice(before.authUserIds),
    profileUserIds: events.profileUserIds.slice(before.profileUserIds),
    membershipUserIds: events.membershipUserIds.slice(before.membershipUserIds),
  };
}

function scalarCounts(delta) {
  return {
    refresh: delta.refresh,
    authUser: delta.authUser,
    profiles: delta.profiles,
    memberships: delta.memberships,
  };
}

function assertNoServiceRoleAfterAuthFailure(delta, context) {
  assert.equal(
    delta.serviceRole,
    0,
    `${context} must perform zero service-role requests after Auth failure`,
  );
  serviceRoleFailureProofs[context] = delta.serviceRole;
}

function assertNoProtectedWorkAfterAuthFailure(delta, context) {
  assertNoServiceRoleAfterAuthFailure(delta, context);
  assert.equal(
    delta.todayPageBookings,
    0,
    `${context} must perform zero protected page-data requests after Auth failure`,
  );
  protectedWorkFailureProofs[context] = {
    serviceRole: delta.serviceRole,
    todayPageBookings: delta.todayPageBookings,
  };
}

function assertExactRedirect(response, target) {
  assert.ok(
    [303, 307, 308].includes(response.status),
    `unexpected raw redirect status ${response.status}`,
  );
  assert.ok(response.headers.location, "raw redirect omitted Location");
  const location = new URL(
    response.headers.location,
    `http://127.0.0.1:${appPort}`,
  );
  assert.equal(`${location.pathname}${location.search}`, target);
}

function assertRedirect(response, target) {
  assert.ok(
    [200, 303, 307, 308].includes(response.status),
    `unexpected redirect status ${response.status}`,
  );
  const expected = normalizedRedirectTarget(target);
  const candidates = redirectTargets(response);
  const expectedUrl = new URL(expected, new URL(CANONICAL_URL).origin);
  const requireExactQueryAndHash = expectedUrl.search.length > 0 || expectedUrl.hash.length > 0;
  const matched = candidates.some((candidate) => {
    if (requireExactQueryAndHash) return candidate === expected;
    if (!candidate.startsWith("/")) return false;
    const candidateUrl = new URL(candidate, expectedUrl.origin);
    return candidateUrl.pathname === expectedUrl.pathname;
  });
  assert.ok(
    matched,
    `redirect target did not equal ${expected}; status=${response.status}; candidates=${JSON.stringify(candidates)}; body=${String(response.body ?? "").slice(0, 2_000)}`,
  );
}

function redirectTargets(response) {
  const targets = [];
  const add = (value) => {
    if (typeof value !== "string" || value.length === 0) return;
    try {
      targets.push(normalizedRedirectTarget(value));
    } catch {}
  };

  const locations = Array.isArray(response.headers.location)
    ? response.headers.location
    : [response.headers.location];
  for (const location of locations) add(location);

  const actionRedirects = Array.isArray(response.headers["x-action-redirect"])
    ? response.headers["x-action-redirect"]
    : [response.headers["x-action-redirect"]];
  for (const actionRedirect of actionRedirects) {
    if (typeof actionRedirect === "string") {
      add(actionRedirect.split(";", 1)[0]);
    }
  }

  const body = String(response.body ?? "");
  for (const match of body.matchAll(
    /NEXT_REDIRECT;(?:replace|push);([^;]+);(?:303|307|308);/g,
  )) {
    add(match[1]);
  }
  for (const match of body.matchAll(
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*?url=([^"']+)["'][^>]*>/gi,
  )) {
    add(match[1]);
  }

  return [...new Set(targets)];
}

function normalizedRedirectTarget(value) {
  const decoded = String(value)
    .trim()
    .replace(/&amp;/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  const expectedOrigin = new URL(CANONICAL_URL).origin;
  const url = new URL(decoded, expectedOrigin);
  return url.origin === expectedOrigin
    ? `${url.pathname}${url.search}${url.hash}`
    : url.href;
}

async function browserRequest({
  actorKey = null,
  cookieJar: suppliedCookieJar,
  path = "/admin/today",
}) {
  const cookieJar = suppliedCookieJar
    ? new Map(suppliedCookieJar)
    : cookieJarFromHeader(actorKey ? authCookie(actorKey) : "");
  let currentPath = path;
  let redirects = 0;
  let setCookieCount = 0;
  const steps = [];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const refreshCountBeforeStep = counts.refresh;
    const response = await appRequest({
      actorKey: null,
      cookieHeader: cookieHeaderFromJar(cookieJar),
      path: currentPath,
    });
    setCookieCount += applySetCookies(cookieJar, response.headers["set-cookie"]);
    const location = response.headers.location;
    steps.push({
      path: new URL(currentPath, `http://127.0.0.1:${appPort}`).pathname,
      status: response.status,
      location: location
        ? new URL(location, `http://127.0.0.1:${appPort}`).pathname
        : null,
      refreshes: counts.refresh - refreshCountBeforeStep,
      setCookies: setCookieNames(response.headers["set-cookie"]),
      cookieWrites: setCookieSecurity(response.headers["set-cookie"]),
    });
    if (![303, 307, 308].includes(response.status) || !location) {
      return { response, cookieJar, redirects, setCookieCount, steps };
    }
    const next = new URL(location, `http://127.0.0.1:${appPort}`);
    const localAppHost = `127.0.0.1:${appPort}`;
    assert.ok(
      next.host === CANONICAL_HOST || next.host === localAppHost,
      `production redirect escaped the application boundary: ${next.host}`,
    );
    const current = new URL(currentPath, `http://127.0.0.1:${appPort}`);
    if (
      next.pathname === "/auth/refresh" ||
      current.pathname === "/auth/refresh"
    ) {
      assert.equal(
        next.host,
        CANONICAL_HOST,
        "the explicit refresh boundary must use the canonical public origin",
      );
    }
    const followsRefreshBoundary = next.pathname === "/auth/refresh";
    const followsTerminalClearBoundary =
      next.pathname === "/auth/session-invalid";
    const followsProtectedDestination =
      current.pathname === "/auth/refresh" &&
      (next.pathname.startsWith("/admin") ||
        next.pathname.startsWith("/portal"));
    if (
      !followsRefreshBoundary &&
      !followsTerminalClearBoundary &&
      !followsProtectedDestination
    ) {
      return { response, cookieJar, redirects, setCookieCount, steps };
    }
    currentPath = `${next.pathname}${next.search}`;
    redirects += 1;
  }
  throw new Error("authenticated HTTP probe exceeded its redirect limit");
}

function cookieJarFromHeader(header) {
  const jar = new Map();
  for (const pair of header.split(/;\s*/)) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return jar;
}

function cookieHeaderFromJar(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function supabaseAuthCookieNames(jar) {
  const projectRef = supabaseUrl.hostname.split(".")[0];
  const authCookieName = `sb-${projectRef}-auth-token`;
  return [...jar.keys()].filter(
    (name) => name === authCookieName || name.startsWith(`${authCookieName}.`),
  );
}

function applySetCookies(jar, setCookieHeaders) {
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  for (const header of headers) {
    const [pair, ...attributes] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const deleted = attributes.some((attribute) =>
      /^\s*max-age=0\s*$/i.test(attribute),
    );
    if (deleted) jar.delete(name);
    else jar.set(name, value);
  }
  return headers.length;
}

function setCookieNames(setCookieHeaders) {
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  return headers.map((header) => header.slice(0, header.indexOf("=")));
}

function setCookieSecurity(setCookieHeaders) {
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  return headers.map((header) => {
    const [pair, ...attributes] = header.split(";");
    const separator = pair.indexOf("=");
    return {
      name: separator > 0 ? pair.slice(0, separator).trim() : "",
      positive: separator > 0 && pair.slice(separator + 1).trim().length > 0 &&
        !attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute)),
      secure: attributes.some((attribute) => /^\s*secure\s*$/i.test(attribute)),
    };
  });
}

function appRequest({
  actorKey,
  body = null,
  cookieHeader,
  extraHeaders = {},
  method = "GET",
  path = "/admin/today",
}) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(path, `http://127.0.0.1:${appPort}`);
    const pathAndQuery = `${requestUrl.pathname}${requestUrl.search}`;
    const headers = {
      Host: PRODUCTION_PROXY_HOST,
      Accept: "text/html",
      ...productionProxyHeaders(method, pathAndQuery),
      ...extraHeaders,
    };
    if (body !== null) headers["Content-Length"] = Buffer.byteLength(body);
    if (cookieHeader) headers.Cookie = cookieHeader;
    else if (actorKey) headers.Cookie = authCookie(actorKey);
    const request = http.request(
      {
        host: "127.0.0.1",
        port: appPort,
        path: pathAndQuery,
        method,
        headers,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length < 50_000) body += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body ?? undefined);
  });
}

function fakeSupabaseRequest({
  apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  authorization,
  method = "GET",
  path,
}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: supabaseUrl.hostname,
        port: fakePort,
        path,
        method,
        headers: {
          apikey,
          authorization,
          accept: "application/vnd.pgrst.object+json",
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode, body }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function productionProxyHeaders(method, pathAndQuery) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const payload = [
    "pixel-booking-proxy-v1",
    timestamp,
    method.toUpperCase(),
    CANONICAL_HOST.toLowerCase(),
    pathAndQuery,
  ].join("\n");
  const signature = createHmac("sha256", PROXY_SECRET)
    .update(payload)
    .digest("hex");
  return {
    "X-Forwarded-Host": CANONICAL_HOST,
    "X-Forwarded-Proto": "https",
    "X-Pixel-Proxy-Timestamp": timestamp,
    "X-Pixel-Proxy-Host": CANONICAL_HOST,
    "X-Pixel-Proxy-Signature": signature,
  };
}

async function waitForApp() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next exited early (${child.exitCode}): ${childOutput}`);
    }
    try {
      await new Promise((resolve, reject) => {
        const request = http.get(
          `http://127.0.0.1:${appPort}/icon.png`,
          (response) => {
            response.resume();
            response.on("end", resolve);
          },
        );
        request.on("error", reject);
      });
      return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Next did not become ready: ${childOutput}`);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 65_536) reject(new Error("request body too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

async function reservePort() {
  const reservation = http.createServer();
  await listen(reservation, 0);
  const address = reservation.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => reservation.close(resolve));
  return port;
}

function refreshSessionJson(response, session) {
  const actor = actorFromAuthorization(`Bearer ${session.access_token}`);
  assert.ok(actor, "a synthetic refresh response must carry an identifiable token");
  const pendingTokens =
    pendingRefreshProofTokensByActor.get(actor.id) ?? new Set();
  pendingTokens.add(session.access_token);
  pendingRefreshProofTokensByActor.set(actor.id, pendingTokens);
  return json(response, 200, session);
}

function json(response, status, value) {
  if (response.headersSent) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "content-range": Array.isArray(value)
      ? `0-${Math.max(0, value.length - 1)}/${value.length}`
      : "0-0/1",
  });
  response.end(body);
}
