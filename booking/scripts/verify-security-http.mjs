import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";

import { tsImport } from "tsx/esm/api";

const attestationModule = await tsImport(
  "../lib/security/production-proxy-attestation.ts",
  import.meta.url,
);
const { signProductionProxyAttestation } =
  attestationModule.default ?? attestationModule;

const CANONICAL_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ci.example.invalid";
const CANONICAL_HOST = new URL(CANONICAL_URL).host;
const PRODUCTION_PROXY_HOST = "pixel-blaster-media.vercel.app";
const DIRECT_HOST = "production-deployment-abc123.vercel.app";
const PROXY_SECRET =
  process.env.BOOKING_PROXY_SHARED_SECRET ??
  "ci-only-proxy-attestation-secret-0123456789abcdef";
const buildManifest = JSON.parse(
  await readFile(new URL("../.next/build-manifest.json", import.meta.url), "utf8"),
);
const realNextAsset = `/_next/${buildManifest.rootMainFiles?.[0] ?? ""}`;
assert.notEqual(realNextAsset, "/_next/", "production build has no root JavaScript asset");

const port = await availablePort();
const serverOutput = [];
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
  {
    env: {
      ...process.env,
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_PROXY_HOST,
      NEXT_PUBLIC_APP_URL: CANONICAL_URL,
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ci-placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "ci-anon-key",
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "ci-service-role-key",
      CRON_SECRET: process.env.CRON_SECRET ?? "ci-cron-secret",
      AUTH_RECOVERY_SECRET:
        process.env.AUTH_RECOVERY_SECRET ?? "ci-recovery-secret",
      BOOKING_MANAGE_SECRET:
        process.env.BOOKING_MANAGE_SECRET ?? "ci-booking-manage-secret",
      BOOKING_PROXY_SHARED_SECRET: PROXY_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

server.stdout.on("data", rememberServerOutput);
server.stderr.on("data", rememberServerOutput);

try {
  await waitUntilReady();
  await runAssertions();
  console.log("Built-artifact HTTP security suite passed.");
} catch (error) {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(detail);
  if (serverOutput.length) {
    console.error("\nNext server output:\n" + serverOutput.join(""));
  }
  process.exitCode = 1;
} finally {
  await stopServer();
}

function rememberServerOutput(chunk) {
  serverOutput.push(String(chunk));
  if (serverOutput.join("").length > 32_000) serverOutput.shift();
}

async function availablePort() {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  assert.ok(address && typeof address === "object");
  const selectedPort = address.port;
  socket.close();
  await once(socket, "close");
  return selectedPort;
}

async function waitUntilReady() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next server exited before readiness (${server.exitCode}).`);
    }
    try {
      const response = await request("GET", "/icon.png", CANONICAL_HOST);
      if (response.status === 200) return;
    } catch {
      // The TCP listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Next server did not become ready within 20 seconds.");
}

async function productionProxyHeaders(method, path, timestamp = Math.floor(Date.now() / 1_000)) {
  const timestampText = String(timestamp);
  const signature = await signProductionProxyAttestation(
    {
      timestamp: timestampText,
      method,
      host: CANONICAL_HOST,
      pathAndQuery: path,
    },
    PROXY_SECRET,
  );
  return {
    "X-Forwarded-Host": CANONICAL_HOST,
    "X-Forwarded-Proto": "https",
    "X-Pixel-Proxy-Timestamp": timestampText,
    "X-Pixel-Proxy-Host": CANONICAL_HOST,
    "X-Pixel-Proxy-Signature": signature,
  };
}

async function runAssertions() {
  let response = await request("GET", "/book?step=1", DIRECT_HOST);
  expectStatus("alias_get_redirect", response, 307);
  assert.equal(response.headers.location, `${CANONICAL_URL}/book?step=1`);

  response = await request("GET", "/icon.png", DIRECT_HOST);
  expectStatus("alias_static_redirect", response, 307);
  assert.equal(response.headers.location, `${CANONICAL_URL}/icon.png`);

  response = await request("GET", "/book", "legacy-production.example");
  expectStatus("custom_host_redirect", response, 307);
  assert.equal(response.headers.location, `${CANONICAL_URL}/book`);

  response = await request(
    "GET",
    "/icon.png",
    PRODUCTION_PROXY_HOST,
    await productionProxyHeaders("GET", "/icon.png"),
  );
  expectStatus("canonical_proxy_static", response, 200);

  response = await request("GET", "/icon.png", PRODUCTION_PROXY_HOST, {
    "X-Forwarded-Host": CANONICAL_HOST,
    "X-Forwarded-Proto": "https",
  });
  expectStatus("unsigned_proxy_spoof_rejected", response, 307);

  const forgedProxyHeaders = await productionProxyHeaders("GET", "/icon.png");
  forgedProxyHeaders["X-Pixel-Proxy-Signature"] = "00".repeat(32);
  response = await request(
    "GET",
    "/icon.png",
    PRODUCTION_PROXY_HOST,
    forgedProxyHeaders,
  );
  expectStatus("forged_proxy_attestation_rejected", response, 307);

  response = await request(
    "GET",
    realNextAsset,
    PRODUCTION_PROXY_HOST,
  );
  expectStatus("direct_stable_next_asset_containment", response, 307);
  assert.equal(response.headers.location, `${CANONICAL_URL}${realNextAsset}`);

  response = await request(
    "GET",
    realNextAsset,
    PRODUCTION_PROXY_HOST,
    await productionProxyHeaders("GET", realNextAsset),
  );
  expectStatus("signed_proxy_real_next_asset", response, 200);
  assert.match(
    String(response.headers["content-type"]),
    /(?:java|ecma)script/,
    "real Next.js bundle did not return JavaScript",
  );

  for (const [label, path, contentType] of [
    ["signed_proxy_manifest", "/manifest.webmanifest", /manifest|json/],
    ["signed_proxy_service_worker", "/sw.js", /javascript/],
    ["signed_proxy_pwa_icon", "/icons/icon-192.png", /image\/png/],
  ]) {
    response = await request(
      "GET",
      path,
      PRODUCTION_PROXY_HOST,
      await productionProxyHeaders("GET", path),
    );
    expectStatus(label, response, 200);
    assert.match(String(response.headers["content-type"]), contentType);
  }

  response = await request(
    "GET",
    realNextAsset,
    DIRECT_HOST,
  );
  expectStatus("generated_host_next_asset_containment", response, 307);

  response = await request("GET", "/icon.png", PRODUCTION_PROXY_HOST, {
    "X-Forwarded-Host": "attacker.example",
    "X-Forwarded-Proto": "https",
  });
  expectStatus("noncanonical_proxy_redirect", response, 307);
  assert.equal(response.headers.location, `${CANONICAL_URL}/icon.png`);

  response = await request("GET", "/icon.png", DIRECT_HOST, {
    "X-Forwarded-Host": CANONICAL_HOST,
    "X-Forwarded-Proto": "https",
  });
  expectStatus("generated_host_forwarded_spoof", response, 307);

  response = await request(
    "POST",
    "/api/auth/bridge",
    PRODUCTION_PROXY_HOST,
    {
      "Content-Type": "application/json",
      Origin: CANONICAL_URL,
      ...(await productionProxyHeaders("POST", "/api/auth/bridge")),
    },
    Buffer.from("{}"),
  );
  expectStatus("canonical_proxy_bridge_origin", response, 400);

  response = await request(
    "POST",
    "/api/auth/bridge",
    PRODUCTION_PROXY_HOST,
    {
      "Content-Type": "application/json",
      Origin: CANONICAL_URL,
      "X-Forwarded-Host": CANONICAL_HOST,
      "X-Forwarded-Proto": "https",
    },
    Buffer.from("{}"),
  );
  expectStatus("unsigned_proxy_bridge_rejected", response, 421);

  response = await request(
    "POST",
    "/definitely-missing.png",
    DIRECT_HOST,
    { "Content-Type": "application/json" },
    Buffer.from("{}"),
  );
  expectStatus("alias_extension_mutation", response, 421);
  assert.equal(response.headers["cache-control"], "no-store");

  response = await request(
    "POST",
    "/api/integrations/iguide/webhook",
    DIRECT_HOST,
    { "Content-Type": "application/json" },
    Buffer.from("{}"),
  );
  expectStatus("alias_webhook_mutation", response, 421);

  response = await request(
    "GET",
    "/api/integrations/quickbooks/callback?code=a&state=b&realmId=c",
    DIRECT_HOST,
  );
  expectStatus("alias_oauth_redirect", response, 307);
  assert.equal(
    response.headers.location,
    `${CANONICAL_URL}/api/integrations/quickbooks/callback?code=a&state=b&realmId=c`,
  );

  response = await request("GET", "/api/cron/reminders", DIRECT_HOST);
  assert.notEqual(response.status, 307, "cron requests must not redirect");
  assert.notEqual(response.status, 421, "cron requests must not be host-rejected");
  console.log(`alias_cron_passthrough=${response.status}`);

  for (const [label, origin] of [
    ["bridge_missing_origin", null],
    ["bridge_cross_origin", "https://attacker.example"],
  ]) {
    const headers = { "Content-Type": "application/json" };
    if (origin) headers.Origin = origin;
    response = await request(
      "POST",
      "/api/auth/bridge",
      CANONICAL_HOST,
      headers,
      Buffer.from("{}"),
    );
    expectStatus(label, response, 403);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["set-cookie"], undefined);
  }

  response = await request(
    "POST",
    "/api/auth/bridge",
    CANONICAL_HOST,
    {
      "Content-Type": "application/json",
      Origin: `http://${CANONICAL_HOST}`,
    },
    Buffer.from("{}"),
  );
  expectStatus("bridge_same_origin_reaches_validation", response, 400);

  response = await request(
    "POST",
    "/api/auth/bridge",
    CANONICAL_HOST,
    {
      "Content-Type": "text/plain",
      Origin: `http://${CANONICAL_HOST}`,
    },
    Buffer.from("{}"),
  );
  expectStatus("bridge_media_type", response, 415);

  response = await request(
    "POST",
    "/api/auth/bridge",
    CANONICAL_HOST,
    {
      "Content-Type": "application/json",
      Origin: `http://${CANONICAL_HOST}`,
    },
    [Buffer.from('{"value":"'), Buffer.alloc(50_000, "a"), Buffer.from('"}')],
  );
  expectStatus("bridge_chunked_body_limit", response, 413);

  response = await request("GET", "/icon.png", CANONICAL_HOST);
  expectStatus("canonical_static", response, 200);
  assert.equal(response.headers["x-frame-options"], "SAMEORIGIN");
  const contentSecurityPolicy = String(response.headers["content-security-policy"]);
  assert.match(contentSecurityPolicy, /frame-ancestors 'self'/);
  assert.match(contentSecurityPolicy, /script-src 'self'/);
  assert.doesNotMatch(
    contentSecurityPolicy,
    /pixel-blaster-media\.vercel\.app/,
    "same-origin asset rewrites must not require trusting the public upstream in CSP",
  );
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  console.log("live_security_headers=ok");
}

function request(method, path, host, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: { Host: host, ...headers },
        timeout: 10_000,
      },
      (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => chunks.push(chunk));
        incoming.on("end", () => {
          resolve({
            status: incoming.statusCode,
            headers: incoming.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error("HTTP probe timed out.")));
    outgoing.on("error", reject);
    if (Array.isArray(body)) {
      for (const chunk of body) outgoing.write(chunk);
      outgoing.end();
    } else {
      outgoing.end(body);
    }
  });
}

function expectStatus(label, response, status) {
  assert.equal(
    response.status,
    status,
    `${label}: expected ${status}, received ${response.status}; ${response.body.slice(0, 200)}`,
  );
  if (status === 307) {
    assert.equal(
      response.headers["cache-control"],
      "no-store",
      `${label}: canonical redirects must not be cached`,
    );
  }
  console.log(`${label}=${response.status}`);
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
