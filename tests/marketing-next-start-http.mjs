import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";

import middleware from "../middleware.js";

const canonicalUrl = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
const CANONICAL_ORIGIN = canonicalUrl.origin;
const CANONICAL_HOST = canonicalUrl.hostname;
const STABLE_HOST = "pixel-blaster-media.vercel.app";
const BOOKING_DIR = fileURLToPath(new URL("../booking/", import.meta.url));
const BOOKING_BUILD_ID = (
  await readFile(new URL("../booking/.next/BUILD_ID", import.meta.url), "utf8")
).trim();
const PROXY_HEADER_NAMES = [
  "x-pixel-proxy-timestamp",
  "x-pixel-proxy-host",
  "x-pixel-proxy-signature",
];

assert.equal(
  canonicalUrl.protocol,
  "https:",
  "NEXT_PUBLIC_APP_URL must be an HTTPS origin for the built HTTP probe",
);
assert.equal(
  process.env.NEXT_PUBLIC_APP_URL,
  CANONICAL_ORIGIN,
  "NEXT_PUBLIC_APP_URL must not include credentials, a path, query, or fragment",
);
process.env.BOOKING_PROXY_CANONICAL_HOST = CANONICAL_HOST;
assert.match(BOOKING_BUILD_ID, /^[A-Za-z0-9_-]+$/);

assert.ok(
  new TextEncoder().encode(process.env.BOOKING_PROXY_SHARED_SECRET ?? "")
    .byteLength >= 32,
  "BOOKING_PROXY_SHARED_SECRET must be set for the built HTTP probe",
);
assert.equal(
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
  STABLE_HOST,
  "built HTTP probe must use the production stable-host topology",
);

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function request({ port, path, method = "GET", headers = {} }) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers,
      },
      (response) => {
        response.resume();
        response.once("end", () =>
          resolve({
            status: response.statusCode,
            location: response.headers.location ?? null,
            cacheControl: response.headers["cache-control"] ?? null,
          }),
        );
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

async function forwardedHeaders(publicUrl, method = "GET") {
  const response = await middleware(new Request(publicUrl, { method }));
  assert.equal(response.status, 200, `outer signer rejected ${publicUrl}`);

  const headers = {
    host: STABLE_HOST,
    "x-forwarded-host": response.headers.get(
      "x-middleware-request-x-forwarded-host",
    ),
    "x-forwarded-proto": response.headers.get(
      "x-middleware-request-x-forwarded-proto",
    ),
  };

  for (const name of PROXY_HEADER_NAMES) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    assert.ok(value, `outer signer omitted ${name} for ${publicUrl}`);
    headers[name] = value;
  }

  return headers;
}

function rawPath(publicUrl) {
  const url = new URL(publicUrl);
  return `${url.pathname}${url.search}`;
}

async function waitForReady(port, childState, logs) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (childState.exited) {
      throw new Error(
        `next start exited before readiness (${childState.code ?? childState.signal})\n${logs.value}`,
      );
    }

    try {
      const response = await request({
        port,
        path: "/api/health",
        headers: {
          host: CANONICAL_HOST,
          "x-forwarded-proto": "https",
        },
      });
      if (response.status === 200) return;
    } catch {
      // The server may not have bound the port yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`next start did not become ready\n${logs.value}`);
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

const port = await reservePort();
const logs = { value: "" };
const childState = { exited: false, code: null, signal: null };
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
  {
    cwd: BOOKING_DIR,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    logs.value = `${logs.value}${chunk.toString()}`.slice(-8_000);
  });
}
child.once("exit", (code, signal) => {
  childState.exited = true;
  childState.code = code;
  childState.signal = signal;
});

try {
  await waitForReady(port, childState, logs);

  const accepted = [
    ["/api/health?filter=active&_rsc=h", "GET", 200],
    ["/api/health?q=two%20words&_rsc=h", "GET", 200],
    ["/api/health?nxtPfilter=active&_rsc=h", "GET", 200],
    ["/api/health?filter=public&nxtPfilter=internal&_rsc=h", "GET", 200],
    ["/api/health?q=.rsc", "GET", 200],
    ["/api/health?tag=one&tag=two&_rsc=h", "GET", 200],
    ["/api/health.rsc?_rsc=h", "GET", 404],
    ["/_next/data/build-id/api/health.json?x=1&_rsc=h", "GET", 404],
    [
      `/_next/data/${BOOKING_BUILD_ID}/api/health.json?x=1&_rsc=h`,
      "GET",
      200,
    ],
    ["/api/health?nxtIfilter=active&_rsc=h", "POST", 405],
    ["/api/health.rsc?_rsc=h", "POST", 404],
  ];

  for (const [path, method, expectedStatus] of accepted) {
    const publicUrl = `${CANONICAL_ORIGIN}${path}`;
    const result = await request({
      port,
      path,
      method,
      headers: await forwardedHeaders(publicUrl, method),
    });
    assert.equal(result.status, expectedStatus, `${method} ${path}`);
    assert.equal(result.location, null, `${method} ${path} must not redirect`);
  }

  const ambiguousDataUrls = [
    `${CANONICAL_ORIGIN}/_next/data/outer/_next/data/foo.json.json?x=1&_rsc=h`,
    `${CANONICAL_ORIGIN}/_next/data/${BOOKING_BUILD_ID}/index/foo.json?x=1&_rsc=h`,
  ];
  for (const publicUrl of ambiguousDataUrls) {
    const response = await middleware(new Request(publicUrl));
    assert.equal(response.status, 400, publicUrl);
    assert.equal(response.headers.get("cache-control"), "no-store", publicUrl);
    for (const name of PROXY_HEADER_NAMES) {
      assert.equal(
        response.headers.get(`x-middleware-request-${name}`),
        null,
        publicUrl,
      );
    }
  }

  const originalUrl = `${CANONICAL_ORIGIN}/api/health?q=two%20words&_rsc=first`;
  const originalHeaders = await forwardedHeaders(originalUrl);
  const changedFrameworkField = await request({
    port,
    path: "/api/health?q=two%20words&_rsc=second",
    headers: originalHeaders,
  });
  assert.equal(changedFrameworkField.status, 200);
  assert.equal(changedFrameworkField.location, null);

  const changedApplicationField = await request({
    port,
    path: "/api/health?q=tampered&_rsc=second",
    headers: originalHeaders,
  });
  assert.deepEqual(changedApplicationField, {
    status: 307,
    location: `${CANONICAL_ORIGIN}/api/health?q=tampered`,
    cacheControl: "no-store",
  });

  const reorderedUrl = `${CANONICAL_ORIGIN}/api/health?tag=one&tag=two&_rsc=h`;
  const reorderedQuery = await request({
    port,
    path: "/api/health?tag=two&tag=one&_rsc=h",
    headers: await forwardedHeaders(reorderedUrl),
  });
  assert.deepEqual(reorderedQuery, {
    status: 307,
    location: `${CANONICAL_ORIGIN}/api/health?tag=two&tag=one`,
    cacheControl: "no-store",
  });

  const methodMismatch = await request({
    port,
    path: rawPath(originalUrl),
    method: "POST",
    headers: originalHeaders,
  });
  assert.deepEqual(methodMismatch, {
    status: 421,
    location: null,
    cacheControl: "no-store",
  });

  const spoofedDirectRequest = await request({
    port,
    path: "/api/health",
    headers: {
      host: STABLE_HOST,
      "x-forwarded-host": CANONICAL_HOST,
      "x-forwarded-proto": "https",
    },
  });
  assert.deepEqual(spoofedDirectRequest, {
    status: 307,
    location: `${CANONICAL_ORIGIN}/api/health`,
    cacheControl: "no-store",
  });

  console.log(
    JSON.stringify({
      passed: true,
      acceptedVectors: accepted.length + 1,
      tamperAndContainmentVectors: 6,
    }),
  );
} finally {
  await stopServer(child);
}
