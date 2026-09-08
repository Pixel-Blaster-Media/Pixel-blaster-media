// Local-only compiled Next reproduction. All account, DB and provider effects are fixtures.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import https from "node:https";
import http from "node:http";
import { createHmac } from "node:crypto";
const root = resolve(import.meta.dirname, "..");
const fixture = mkdtempSync(resolve(tmpdir(), "pixel-auth-browser-"));
const write = (p, s) => {
  mkdirSync(dirname(resolve(fixture, p)), { recursive: true });
  writeFileSync(resolve(fixture, p), s);
};
const copy = (p) => {
  mkdirSync(dirname(resolve(fixture, p)), { recursive: true });
  cpSync(resolve(root, p), resolve(fixture, p), { recursive: true });
};
for (const p of [
  "lib",
  "middleware.ts",
  "tsconfig.json",
  "app/globals.css",
  "tailwind.config.ts",
  "postcss.config.mjs",
  "app/book/actions.ts",
  "app/book/confirm/ConfirmForm.tsx",
  "app/book/confirm/page.tsx",
  "app/book/confirm/ConfirmUpsellPanel.tsx",
  "app/book/_components/BookingBrandHeader.tsx",
  "app/book/_components/Stepper.tsx",
  "app/book/_components/BookingTotalBar.tsx",
  "app/auth/password",
  "app/auth/sign-in/page.tsx",
  "app/auth/continue/route.ts",
])
  copy(p);
symlinkSync(
  resolve(root, "node_modules"),
  resolve(fixture, "node_modules"),
  "dir",
);
write(
  "package.json",
  JSON.stringify({ private: true, scripts: { build: "next build --webpack" } }),
);
write(
  "next.config.mjs",
  "export default {typescript:{ignoreBuildErrors:true}};",
);
write(
  "app/layout.tsx",
  `import './globals.css';export default function Layout({children}) { return <html><body className="realtor-theme realtor-backdrop"><main className="mx-auto max-w-xl px-4 py-6">{children}</main></body></html> }`,
);
write(
  "app/error.tsx",
  `'use client'; export default function Error(){return <h1>GLOBAL FAILURE</h1>}`,
);
const org = "11111111-1111-4111-8111-111111111111";
const property = "33333333-3333-4333-8333-333333333333";
const user = "44444444-4444-4444-8444-444444444444";
write(
  "lib/fixture.ts",
  `import {cookies} from 'next/headers';export const profile={id:'${user}',email:'controlled@example.invalid',organization_id:'${org}',role:'realtor',archived_at:null};
export const state=(globalThis as any).__pixelFixture??=((globalThis as any).__pixelFixture={bookings:0,identities:0});
export const service={auth:{getUser:async(token)=>({data:{user:(token||(await cookies()).has('sb-localhost-auth-token'))?profile:null},error:null})},from(table){const q={select(){return q},eq(){return q},in(){return q},limit(){return q},update(){return q},returns(){return q},maybeSingle:async()=>({data:table==='profiles'?profile:null,error:null}),then(r){r({data:null,error:null})}};return q},async rpc(name,args){if(name==='begin_public_booking_verification'||name==='verify_public_booking_inbox')return {data:true,error:null};if(name!=='create_public_booking_with_jobs')throw Error(name);state.bookings++;return {data:{booking_id:'55555555-5555-4555-8555-555555555555',property_id:'${property}',scheduled_ends_at:'2027-01-10T17:00:00Z'},error:null}}};`,
);
const mocks = {
  "auth/current-user": `export async function getCurrentUser(){return null}`,
  "auth/email-lookup": `export async function emailHasAccount(){return false}`,
  "auth/provision-realtor": `import {state} from '@/lib/fixture'; export async function provisionRealtorAuthUser(){state.identities++;return {ok:true,userId:'${user}',provisioningId:'fixture'}}`,
  "auth/rollback-provisioned-realtor": `export async function rollbackProvisionedRealtor(){throw Error('Unexpected rollback')}`,
  "auth/public-booking-verification": `export function publicBookingFingerprint(){return 'a'.repeat(64)};export async function requirePublicBookingInbox(p){return p.code==='12345678'?{ok:true}:{ok:false,verificationRequired:true}}`,
  "booking/availability": `export const BUSINESS_TZ='America/Toronto';export async function isSlotAvailable(){return true}`,
  "booking/catalog": `export async function getActiveCatalog(){return {bundles:[{id:'catalog-1',slug:'blue-print',name:'Blue Print',kind:'bundle',price_cents:10000,duration_minutes:60}],addons:[],aLaCarte:[{id:'photo-1',slug:'residential_photography',name:'Residential photos',kind:'a_la_carte',price_cents:5000,duration_minutes:30}]}};export function getCatalogItemPrice(item){return {totalPriceCents:item.price_cents,overageCents:0}}`,
  "booking/catalog-rules": `export function isAddonEligible(){return true}`,
  "booking/manage-token": `export function createManageToken(){return 'fixture-manage'}`,
  "email/settings": `export async function getAdminNotificationEmail(){return null}`,
  "email/resend": `export async function sendEmail(){return {ok:true,id:'fixture'}}`,
  "integrations/dispatcher": `export async function dispatchBookingIntegrationJobs(){}`,
  "integrations/dispatcher-core": `export function buildIntegrationWorkerId(){return 'fixture'}`,
  "organizations/public-booking": `export async function resolvePublicBookingOrganization(){return {id:'${org}',name:'Controlled company',slug:'controlled'}}`,
  "supabase/server": `import {service} from '@/lib/fixture';export function getServiceSupabase(){return service};export async function getServerSupabase(){return service}`,
};
for (const [p, s] of Object.entries(mocks)) write("lib/" + p + ".ts", s);
// Keep the real cookie installation / claims validation, replacing only the password grant transport.
let cookieSource = readFileSync(
  resolve(root, "lib/auth/set-session-cookie.ts"),
  "utf8",
);
const start = cookieSource.indexOf(
  "  const supabaseUrl =",
  cookieSource.indexOf("export async function signInWithPasswordREST"),
);
const end = cookieSource.indexOf(
  "\nasync function readBoundedProviderJson",
  start,
);
cookieSource =
  cookieSource.slice(0, start) +
  `  const b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');const token=b64({alg:'HS256'})+'.'+b64({sub:'${user}',aud:'authenticated',role:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})+'.fixture';return {ok:true,tokens:{access_token:token,refresh_token:'fixture-refresh',expires_in:3600}};\n}\n` +
  cookieSource.slice(end);
write(
  "lib/auth/set-session-cookie.ts",
  cookieSource.replace(
    "  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;",
    '  if (process.env.PIXEL_TEST_COOKIE_FAILURE === "1") throw new Error("Synthetic session installation failure");\n  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;',
  ),
);
write(
  "app/portal/[id]/page.tsx",
  `import {cookies} from 'next/headers';import Link from 'next/link';export default async function Page(){const c=await cookies();return <><h1>{c.has('sb-localhost-auth-token')?'SIGNED IN PORTAL':'MISSING SESSION'}</h1><Link href="/auth/sign-in?audience=realtor">Sign in control</Link></>}`,
);
write(
  "app/book/success/page.tsx",
  `export default function Page(){return <h1>BOOKING CONFIRMED</h1>}`,
);
write(
  "app/api/fixture/route.ts",
  `import {state} from '@/lib/fixture';export async function GET(){return Response.json(state)}`,
);
const port = await freePort(),
  proxyPort = await freePort();
const canonical = `https://127.0.0.1:${proxyPort}`;
const canonicalHost = "127.0.0.1";
const secret = "local-only-attestation-secret-0123456789abcdef";
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  NEXT_PUBLIC_APP_URL: canonical,
  VERCEL_ENV: "production",
  BOOKING_PROXY_UPSTREAM_HOST: "pixel-blaster-media.vercel.app",
  BOOKING_PROXY_SHARED_SECRET: secret,
  NODE_TLS_REJECT_UNAUTHORIZED: "0",
};
for (const k of Object.keys(env))
  if (/^(RESEND|QUICKBOOKS|GOOGLE|AWS|R2_|CLOUDFLARE)/.test(k)) delete env[k];
console.log(JSON.stringify({ fixture, port, proxyPort }));
execFileSync(
  process.execPath,
  [resolve(root, "node_modules/next/dist/bin/next"), "build", "--webpack"],
  {
    cwd: fixture,
    env,
    stdio: ["ignore", writeLog("build.log"), writeLog("build.err.log")],
  },
);
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    resolve(fixture, "key.pem"),
    "-out",
    resolve(fixture, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
  ],
  { stdio: "ignore" },
);
const events = [];
const proxy = https.createServer(
  {
    key: readFileSync(resolve(fixture, "key.pem")),
    cert: readFileSync(resolve(fixture, "cert.pem")),
  },
  (req, res) => {
    const url = new URL(req.url, canonical);
    url.searchParams.delete("_rsc");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      ...req.headers,
      host: "pixel-blaster-media.vercel.app",
      "x-forwarded-host": canonicalHost,
      "x-forwarded-proto": "https",
      "x-pixel-proxy-host": canonicalHost,
      "x-pixel-proxy-timestamp": timestamp,
      "x-pixel-proxy-signature": createHmac("sha256", secret)
        .update(
          [
            "pixel-booking-proxy-v1",
            timestamp,
            req.method,
            canonicalHost,
            url.pathname + url.search,
          ].join("\n"),
        )
        .digest("hex"),
    };
    // Next CSRF compares the original browser Origin, including this local-only port.
    if (headers.origin === canonical)
      headers.origin = "https://" + canonicalHost;
    const event = {
      method: req.method,
      path: url.pathname,
      cookieNames: (req.headers.cookie ?? "")
        .split(";")
        .filter(Boolean)
        .map((c) => c.split("=")[0].trim()),
      action: !!req.headers["next-action"],
    };
    events.push(event);
    const upstream = http.request(
      {
        hostname: "localhost",
        port,
        path: req.url,
        method: req.method,
        headers,
      },
      (r) => {
        event.status = r.statusCode;
        event.type = r.headers["content-type"];
        event.redirect = r.headers["x-action-redirect"];
        event.setCookies = (r.headers["set-cookie"] ?? []).map((c) =>
          c
            .split(";")
            .map((s, i) => (i === 0 ? s.split("=")[0] : s))
            .join(";"),
        );
        if (r.headers.location) {
          const location = new URL(r.headers.location, canonical);
          if (
            location.hostname === "localhost" &&
            location.port === String(port)
          ) {
            location.protocol = "http:";
            r.headers.location = location.href;
          }
        }
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502);
      res.end(e.message);
    });
    req.pipe(upstream);
  },
);
await new Promise((r) => proxy.listen(proxyPort, "127.0.0.1", r));
const child = spawn(
  process.execPath,
  [
    resolve(root, "node_modules/next/dist/bin/next"),
    "start",
    "-p",
    String(port),
  ],
  {
    cwd: fixture,
    env,
    stdio: ["ignore", writeLog("runtime.log"), writeLog("runtime.err.log")],
  },
);
let browser;
try {
  await ready(`http://localhost:${port}/auth/sign-in`);
  const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE ??
      "/tmp/pixel-playwright/node_modules/playwright/index.mjs"
  );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_EXECUTABLE ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(canonical + "/book/confirm?" + new URLSearchParams({services:"blue-print",address:"1 Fictional Street",city:"Hamilton",postal:"L8L1A1",slot:"2027-01-10T16:00:00Z"}));
  await page.getByRole("heading", {name:"Review + confirm", exact:true}).waitFor();
  await page.getByText("Booking summary", {exact:true}).waitFor();
  await page.getByText("Add residential photos", {exact:true}).waitFor();
  assert.match(await page.locator("header").innerText(), /Controlled company[\s\S]*Booking in progress/, "original pre-success brand header remains");
  for (const [name, value] of Object.entries({
    contact_name: "Controlled Test",
    contact_email: "controlled@example.invalid",
    contact_phone: "555-0100",
    password: "controlled-password",
  }))
    await page.locator(`[name="${name}"]`).fill(value);
  await page.getByRole("button", { name: /confirm/i }).click();
  await page
    .getByText("Check your email for an 8-digit code.", { exact: false })
    .waitFor();
  await page.locator('[name="verification_code"]').fill("12345678");
  await page.getByRole("button", { name: /confirm/i }).click();
  await page
    .getByRole("heading", { name: "Booking confirmed", exact: true })
    .waitFor();
  assert.equal(
    await page.locator("form").count(),
    0,
    "committed receipt removes the submission form",
  );
  for (const stale of ["Review + confirm", "Booking summary", "Add residential photos", "Add your contact details and portal password, then confirm the booking."]) {
    assert.equal(await page.getByText(stale, {exact:true}).count(), 0, `receipt removes full review shell: ${stale}`);
  }
  assert.equal(await page.locator("nav").count(), 0, "receipt removes wizard stepper");
  assert.equal(await page.getByText("Booking in progress", {exact:true}).count(), 0, "receipt removes in-progress brand header");
  assert.equal(await page.locator("header").count(), 0, "success receipt owns company branding");
  const cookieFlags = async () =>
    (await context.cookies()).map(
      ({ name, secure, httpOnly, sameSite, path }) => ({
        name,
        secure,
        httpOnly,
        sameSite,
        path,
      }),
    );
  const first = {
    url: page.url(),
    text: await page.locator("body").innerText(),
    cookies: await cookieFlags(),
  };
  assert.equal(await page.evaluate(() => document.activeElement?.id), "booking-confirmed-heading", "success moves focus to the receipt rather than leaving the customer at the removed submit button");
  assert.match(first.text, /1 Fictional Street, Hamilton/);
  assert.match(first.text, /Sunday, January 10, 2027 at 11:00 AM/);
  assert.match(first.text, /Blue Print/);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({
      path: resolve(fixture, `receipt-${width}.png`),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `receipt overflows at ${width}px`,
    );
    const cta = await page
      .getByRole("link", { name: "View booking", exact: true })
      .boundingBox();
    assert.ok(cta.height >= 44);
  }
  if (process.env.PIXEL_TEST_COOKIE_FAILURE === "1") {
    assert.deepEqual(first.cookies, []);
    await page.getByRole("link", { name: "View booking", exact: true }).click();
    await page
      .getByRole("heading", { name: "BOOKING CONFIRMED", exact: true })
      .waitFor();
  } else {
    assert.deepEqual(first.cookies, [
      {
        name: "sb-localhost-auth-token",
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
        path: "/",
      },
    ]);
    await page.getByRole("link", { name: "View booking", exact: true }).click();
    await page
      .getByRole("heading", { name: "SIGNED IN PORTAL", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole("heading", { name: "SIGNED IN PORTAL", exact: true })
      .waitFor();
    // Expired/missing browser session: canonical document bounce, then natural password login.
    await context.clearCookies();
    await page.reload();
    await page.waitForURL("**/auth/sign-in?**");
    await page.locator('[name="email"]').fill("controlled@example.invalid");
    await page.locator('[name="password"]').fill("controlled-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("heading", { name: "SIGNED IN PORTAL", exact: true })
      .waitFor()
      .catch(async (e) => {
        console.log(
          "LOGIN FAILURE",
          page.url(),
          await page.locator("body").innerText(),
          JSON.stringify(events.filter((e) => !e.path.startsWith("/_next"))),
        );
        throw e;
      });
  }
  // These are deliberately unsigned/forged direct-alias actions. They must
  // remain blocked regardless of framework headers; the fix creates no bypass.
  const denied = await fetch(`http://localhost:${port}/auth/sign-in`, {
    method: "POST",
    headers: {
      host: "pixel-blaster-media.vercel.app",
      "x-forwarded-host": canonicalHost,
      "x-forwarded-proto": "https",
      "next-action": "forged",
      "x-action-forwarded": "1",
    },
    redirect: "manual",
  });
  assert.equal(denied.status, 421);
  const counts = await (
    await context.request.get(canonical + "/api/fixture")
  ).json();
  assert.deepEqual(counts, { bookings: 1, identities: 1 });
  const result = {
    first,
    final: {
      url: page.url(),
      text: await page.locator("body").innerText(),
      cookies: await cookieFlags(),
    },
    counts,
    errors,
    events: events.filter((e) => !e.path.startsWith("/_next")),
  };
  assert.equal(
    events.filter((e) => e.method === "POST" && e.path === "/book/confirm")
      .length,
    2,
    "one proof request and one booking commit, no retries",
  );
  assert.equal(
    events.filter((e) => e.action && e.redirect).length,
    0,
    "no internal Server Action redirect optimization",
  );
  assert.deepEqual(errors, []);
  write("evidence.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) => proxy.close(r));
}
function writeLog(p) {
  return awaitlessOpen(resolve(fixture, p));
}
function awaitlessOpen(p) {
  return execOpen(p, "w");
}
import { openSync as execOpen } from "node:fs";
async function freePort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, "localhost", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url, { redirect: "manual" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw Error("local Next not ready");
}
