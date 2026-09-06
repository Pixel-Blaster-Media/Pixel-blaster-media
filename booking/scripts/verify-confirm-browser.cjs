// Built Next/React oracle. All providers are explicit loopback HTTP fixtures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
require("./auth-browser-network.cjs");
assert.throws(
  () => net.connect({ host: "192.0.2.1", port: 443 }),
  /AUTH_BROWSER_FORBIDDEN_EGRESS/,
);
assert.throws(
  () => fetch("https://egress-probe.invalid/"),
  /AUTH_BROWSER_FORBIDDEN_FETCH/,
);
const root = path.resolve(__dirname, "..");
const audit = process.env.AUTH_BROWSER_EVIDENCE_DIR;
assert.ok(audit, "set AUTH_BROWSER_EVIDENCE_DIR");
fs.mkdirSync(audit, { recursive: true });
const tmp = fs.mkdtempSync("/tmp/pixel-confirm-runtime-");
const repo = path.dirname(root);
function git(...args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const identity = {
  head: git("rev-parse", "HEAD"),
  tree: git("rev-parse", "HEAD^{tree}"),
};
let child, browser, provider;
const events = [],
  failures = [],
  stages = [];
let row = null,
  expired = false,
  proof = false,
  inbox = [],
  atomic = null,
  issuedToken = null;
const org = "00000000-0000-0000-0000-000000000001",
  uid = "33333333-3333-4333-8333-333333333333";
const user = {
  id: uid,
  email: "controlled@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
function reply(res, data, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}
function listen(server) {
  return new Promise((r) =>
    server.listen(0, "127.0.0.1", () => r(server.address().port)),
  );
}
async function run() {
  let pw;
  try {
    pw = require("playwright");
  } catch {
    for (const d of fs.readdirSync(path.join(process.env.HOME, ".npm/_npx"))) {
      const p = path.join(
        process.env.HOME,
        ".npm/_npx",
        d,
        "node_modules/playwright",
      );
      if (fs.existsSync(p)) {
        pw = require(p);
        break;
      }
    }
  }
  assert.ok(pw, "install Playwright in a disposable tools directory");
  const clone = spawnSync(
    "git",
    ["clone", "--shared", "--no-hardlinks", repo, tmp],
    { encoding: "utf8" },
  );
  assert.equal(clone.status, 0, clone.stderr);
  assert.equal(
    spawnSync("git", ["checkout", "--detach", identity.head], { cwd: tmp })
      .status,
    0,
  );
  const app = path.join(tmp, "booking");
  fs.symlinkSync(
    fs.realpathSync(path.join(root, "node_modules")),
    path.join(app, "node_modules"),
    "dir",
  );
  assert.equal(
    fs.readdirSync(app).filter((n) => /^\.env/.test(n) && n !== ".env.example")
      .length,
    0,
    "no ambient dotenv files",
  );
  provider = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      let raw = "";
      for await (const c of req) raw += c;
      const b = raw ? JSON.parse(raw) : null;
      const p = u.pathname;
      events.push(req.method + " " + p);
      if (p === "/emails") {
        assert.deepEqual(b.to, ["controlled@example.test"]);
        assert.equal(b.subject, "Verify your booking email");
        inbox.push(b.text.match(/\b\d{8}\b/)[0]);
        return reply(res, { id: "fixture-email-" + inbox.length });
      }
      if (p.endsWith("/begin_public_booking_verification")) {
        await new Promise((r) => setTimeout(r, 250));
        if (row && !expired) return reply(res, false);
        row = b;
        expired = false;
        return reply(res, true);
      }
      if (p.endsWith("/verify_public_booking_inbox")) {
        const ok =
          row && !expired && Object.keys(row).every((k) => row[k] === b[k]);
        if (ok) {
          assert.equal(proof, false);
          proof = true;
        }
        return reply(res, !!ok);
      }
      if (p === "/auth/v1/admin/users") {
        assert.ok(proof);
        assert.equal(b.password, "controlled-password");
        return reply(res, user);
      }
      if (p === "/auth/v1/token") {
        assert.ok(proof);
        assert.equal(u.searchParams.get("grant_type"), "password");
        assert.equal(b.password, "controlled-password");
        const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
        issuedToken =
          enc({ alg: "HS256", typ: "JWT" }) +
          "." +
          enc({
            sub: uid,
            aud: "authenticated",
            role: "authenticated",
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
          }) +
          ".fixture";
        return reply(res, {
          access_token: issuedToken,
          refresh_token: "fixture-refresh",
          expires_in: 3600,
        });
      }
      if (p === "/auth/v1/user") {
        assert.ok(proof);
        assert.equal(req.headers.authorization, "Bearer " + issuedToken);
        return reply(res, user);
      }
      if (p.endsWith("/create_public_booking_with_jobs")) {
        assert.ok(proof);
        assert.equal(b.p_request_id, row.p_request_id);
        assert.match(b.p_client_notes, /retained private note/);
        atomic = b;
        return reply(res, {
          booking_id: "44444444-4444-4444-8444-444444444444",
          property_id: "55555555-5555-4555-8555-555555555555",
          scheduled_ends_at: "2027-01-10T17:00:00Z",
          replayed: false,
        });
      }
      if (p.includes("/rpc/")) {
        if (p.endsWith("/claim_integration_job")) {
          assert.ok(proof);
          assert.ok(atomic);
          assert.equal(b.p_organization_id, org);
          assert.equal(b.p_booking_id, "44444444-4444-4444-8444-444444444444");
          return reply(res, null);
        }
        throw Error("unmodeled RPC " + p);
      }
      const table = p.split("/").pop();
      if (table === "properties") {
        assert.ok(atomic);
        return reply(res, {
          id: "55555555-5555-4555-8555-555555555555",
          street_address: "1 Fictional Street",
          city: "Toronto",
          postal_code: null,
          owner_id: uid,
          bookings: [],
        });
      }
      if (table === "deliverables") return reply(res, []);
      if (table === "listing_websites") return reply(res, null);
      const single = String(req.headers.accept).includes("object");
      if (table === "organizations")
        return reply(res, {
          id: org,
          slug: "fixture",
          name: "Fixture company",
          primary_color: null,
          accent_color: null,
          logo_url: null,
        });
      if (table === "catalog_items")
        return reply(res, [
          {
            id: "66666666-6666-4666-8666-666666666666",
            slug: "blue-print",
            name: "Blue Print",
            kind: "bundle",
            price_cents: 10000,
            duration_minutes: 60,
            active: true,
          },
        ]);
      if (table === "business_hours")
        return reply(
          res,
          Array.from({ length: 7 }, (_, i) => ({
            day_of_week: i,
            start_time: "08:00:00",
            end_time: "18:00:00",
            enabled: true,
          })),
        );
      if (table === "profiles") {
        if (req.method === "PATCH") {
          assert.ok(proof);
          return reply(res, null);
        }
        return reply(
          res,
          proof
            ? {
                ...user,
                organization_id: org,
                role: "realtor",
                full_name: "Controlled Test",
                archived_at: null,
              }
            : null,
        );
      }
      if (
        table === "bookings" &&
        u.searchParams.get("select") === "suppress_realtor_notifications"
      ) {
        assert.ok(atomic);
        return reply(res, { suppress_realtor_notifications: false });
      }
      if (
        [
          "bookings",
          "calendar_blocks",
          "integration_credentials",
          "integration_connections",
          "google_calendar_connection",
          "organization_members",
          "catalog_item_examples",
        ].includes(table)
      ) {
        assert.equal(req.method, "GET");
        return reply(res, single ? null : []);
      }
      throw Error("unmodeled request " + req.method + " " + p);
    } catch (e) {
      failures.push(e.message);
      reply(res, { message: e.message }, 500);
    }
  });
  const port = await listen(provider),
    origin = "http://127.0.0.1:" + port;
  const reserve = http.createServer();
  const appPort = await listen(reserve);
  await new Promise((r) => reserve.close(r));
  const appOrigin = "http://127.0.0.1:" + appPort;
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: "/tmp",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: origin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    NEXT_PUBLIC_APP_URL: appOrigin,
    RESEND_API_KEY: "fixture-resend",
    EMAIL_FROM: "fixture@example.test",
    AUTH_BROWSER_PROVIDER_URL: origin,
    NODE_OPTIONS:
      "--require=" + path.join(__dirname, "auth-browser-network.cjs"),
  };
  const buildLog = fs.openSync(path.join(audit, "confirm-build.log"), "w");
  const build = spawnSync(
    process.execPath,
    [path.join(app, "node_modules/next/dist/bin/next"), "build", "--webpack"],
    { cwd: app, env, stdio: ["ignore", buildLog, buildLog], timeout: 180000 },
  );
  fs.closeSync(buildLog);
  assert.equal(
    build.status,
    0,
    "production build failed; see confirm-build.log",
  );
  assert.ok(fs.existsSync(path.join(app, ".next/BUILD_ID")));
  identity.buildId = fs.readFileSync(path.join(app, ".next/BUILD_ID"), "utf8");
  const runtimeLog = fs.openSync(path.join(audit, "confirm-server.log"), "w");
  child = spawn(
    process.execPath,
    [
      path.join(app, "node_modules/next/dist/bin/next"),
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      String(appPort),
    ],
    { cwd: app, env, stdio: ["ignore", runtimeLog, runtimeLog] },
  );
  fs.closeSync(runtimeLog);
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(appOrigin);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  browser = await pw.chromium.launch({
    headless: true,
    ...(process.env.AUTH_BROWSER_EXECUTABLE
      ? { executablePath: process.env.AUTH_BROWSER_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== appOrigin)
      return route.abort();
    // Hold transport briefly so the genuine React pending state is observable.
    if (route.request().headers()["next-action"])
      await new Promise((r) => setTimeout(r, 200));
    return route.continue();
  });
  const page = await context.newPage();
  const actions = [];
  page.on("response", (r) => {
    if (r.request().headers()["next-action"])
      actions.push({
        status: r.status(),
        redirect: r.headers()["x-action-redirect"] || null,
      });
  });
  await page.goto(
    appOrigin +
      "/book/confirm?" +
      new URLSearchParams({
        org: "fixture",
        services: "blue-print",
        address: "1 Fictional Street",
        city: "Toronto",
        slot: "2027-01-10T16:00:00Z",
        shoot_notes: "retained private note",
      }),
  );
  await page.locator("input[name=password]").waitFor();
  const submit = async () => {
    const response = page.waitForResponse(
      (r) => !!r.request().headers()["next-action"],
    );
    await page
      .getByRole("button", { name: "Confirm booking", exact: true })
      .click();
    const pending = page.getByRole("button", {
      name: "Booking...",
      exact: true,
    });
    await pending.waitFor();
    assert.equal(await pending.isDisabled(), true);
    await response;
    await page
      .getByRole("button", { name: "Confirm booking", exact: true })
      .waitFor();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("role") === "alert",
    );
  };
  await submit();
  for (const n of [
    "contact_name",
    "contact_phone",
    "contact_email",
    "password",
  ]) {
    assert.equal(
      await page.locator("#" + n).getAttribute("aria-invalid"),
      "true",
    );
    assert.equal(
      await page.locator("#" + n).getAttribute("aria-describedby"),
      n + "-error",
    );
  }
  assert.equal(inbox.length, 0);
  stages.push("invalid-errors-focus");
  const values = {
    contact_name: "Controlled Test",
    contact_phone: "555-0100",
    contact_email: user.email,
    brokerage: "Fixture Brokerage",
    password: "controlled-password",
    notes: "retained final note",
  };
  for (const [n, v] of Object.entries(values))
    await page.locator("[name=" + n + "]").fill(v);
  const before = await page
    .locator("form")
    .evaluate((f) =>
      Array.from(new FormData(f)).filter(([k]) => !k.startsWith("$ACTION_")),
    );
  const retained = async () => {
    for (const [n, v] of Object.entries(values))
      assert.equal(await page.locator("[name=" + n + "]").inputValue(), v);
    assert.deepEqual(
      await page
        .locator("form")
        .evaluate((f) =>
          Array.from(new FormData(f)).filter(
            ([k]) => !k.startsWith("$ACTION_") && k !== "verification_code",
          ),
        ),
      before,
    );
    assert.equal(atomic, null);
    assert.equal(proof, false);
    assert.deepEqual(await context.cookies(), []);
    assert.equal(
      events.filter(
        (e) =>
          e.includes("/auth/v1/") ||
          e.startsWith("PATCH ") ||
          e.includes("create_public_booking_with_jobs") ||
          e.includes("claim_integration_job"),
      ).length,
      0,
    );
  };
  await submit();
  assert.equal(inbox.length, 1);
  await retained();
  stages.push("issue-retained");
  await page.locator("#verification_code").fill("not-a-code");
  await submit();
  assert.equal(
    await page.locator("#verification_code").getAttribute("aria-invalid"),
    "true",
  );
  await retained();
  stages.push("wrong-code-retained");
  await page.locator("#verification_code").fill("");
  await submit();
  assert.equal(inbox.length, 1);
  await retained();
  stages.push("cooldown-no-send");
  expired = true;
  await submit();
  assert.equal(inbox.length, 2);
  await retained();
  stages.push("fixture-expiry-resend");
  await page.screenshot({
    path: path.join(audit, "confirm-mobile.png"),
    fullPage: true,
  });
  await page.locator("#verification_code").fill(inbox[1]);

  const success = page.waitForResponse(
    (r) =>
      !!r.request().headers()["next-action"] &&
      !!r.headers()["x-action-redirect"],
  );
  await page
    .getByRole("button", { name: "Confirm booking", exact: true })
    .click();
  const res = await success;
  assert.equal(
    res.headers()["x-action-redirect"],
    "/portal/55555555-5555-4555-8555-555555555555?booked=1;push",
  );
  await res.finished();
  await page.waitForURL(
    appOrigin + "/portal/55555555-5555-4555-8555-555555555555?booked=1",
  );
  await page
    .getByRole("heading", { name: "1 Fictional Street", exact: true })
    .waitFor();
  const cookieHeaders = (await res.headersArray()).filter(
    (h) => h.name.toLowerCase() === "set-cookie",
  );
  assert.equal(cookieHeaders.length, 1);
  const header = cookieHeaders[0].value;
  assert.match(header, /^sb-127-auth-token=base64-/);
  assert.match(header, /; Path=\//i);
  assert.match(header, /; Secure/i);
  assert.match(header, /; SameSite=lax/i);
  assert.match(header, /; Max-Age=34560000/i);
  assert.doesNotMatch(header, /HttpOnly/i);
  const session = JSON.parse(
    Buffer.from(
      decodeURIComponent(header.split(";")[0].split("=")[1]).slice(7),
      "base64url",
    ).toString(),
  );
  const claims = JSON.parse(
    Buffer.from(issuedToken.split(".")[1], "base64url").toString(),
  );
  assert.equal(session.access_token, issuedToken);
  assert.equal(session.refresh_token, "fixture-refresh");
  assert.equal(session.token_type, "bearer");
  assert.equal(session.expires_at, claims.exp);
  assert.ok(session.expires_in > 3500 && session.expires_in <= 3600);
  assert.equal(session.user.id, uid);
  assert.equal(session.user.email, user.email);
  assert.deepEqual(session.user.app_metadata, {});
  assert.deepEqual(session.user.user_metadata, {});
  const cookies = (await context.cookies()).filter((c) =>
    c.name.startsWith("sb-"),
  );
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, "sb-127-auth-token");
  assert.equal(cookies[0].value, header.split(";")[0].split("=")[1]);
  assert.equal(cookies[0].secure, true);
  assert.equal(cookies[0].sameSite, "Lax");
  assert.equal(cookies[0].httpOnly, false);
  const effects = events.filter(
    (e) =>
      e.includes("/auth/v1/") ||
      e.startsWith("PATCH ") ||
      e.includes("create_public_booking_with_jobs") ||
      e.includes("claim_integration_job"),
  );
  assert.deepEqual(effects, [
    "POST /auth/v1/admin/users",
    "PATCH /rest/v1/profiles",
    "POST /auth/v1/token",
    "POST /rest/v1/rpc/create_public_booking_with_jobs",
    "GET /auth/v1/user",
    ...Array(5).fill("POST /rest/v1/rpc/claim_integration_job"),
    // Next internally renders the destination RSC with the installed cookie.
    "GET /auth/v1/user",
  ]);
  assert.equal(
    events.filter((e) => e.endsWith("/begin_public_booking_verification"))
      .length,
    3,
  );
  assert.equal(
    events.filter((e) => e.endsWith("/verify_public_booking_inbox")).length,
    2,
  );
  assert.equal(inbox.length, 2);
  assert.equal(actions.length, 6);
  assert.ok(actions.every((a) => a.status === 200 || a.status === 303));
  assert.ok(atomic);
  assert.equal(failures.length, 0, failures.join("\n"));
  assert.equal(git("rev-parse", "HEAD"), identity.head);
  assert.equal(git("diff", "HEAD", "--", "booking/app", "booking/lib"), "");
  assert.equal(
    fs.readFileSync(path.join(app, ".next/BUILD_ID"), "utf8"),
    identity.buildId,
  );
  assert.equal(
    git(
      "diff",
      "8c181f3",
      identity.head,
      "--",
      "booking/app/book/actions.ts",
      "booking/app/book/confirm",
      "booking/lib/auth",
    ),
    "",
  );
  stages.push(
    "correct-code-booking-redirect",
    "session-cookie-order-counts",
    "source-identity-egress-denied",
  );
  return { actions, effects, cookieAssertions: true };
}
(async () => {
  let result;
  try {
    result = await run();
    console.log("PASS", stages);
  } catch (e) {
    process.exitCode = 1;
    console.error(e.stack);
    result = { error: e.message };
  } finally {
    if (browser) await browser.close();
    if (child) {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
    }
    if (provider) {
      provider.closeAllConnections();
      await new Promise((r) => provider.close(r));
    }
    fs.writeFileSync(
      path.join(audit, "confirm-browser-result.json"),
      JSON.stringify(
        { identity, tmp, stages, failures, events, ...result },
        null,
        2,
      ),
    );
  }
})();
