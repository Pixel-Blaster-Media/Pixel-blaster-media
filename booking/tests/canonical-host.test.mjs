import assert from "node:assert/strict";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const hostModule = await tsImport(
  "../lib/security/canonical-host.ts",
  import.meta.url,
);
const { canonicalHostAction } = hostModule.default;

const base = {
  canonicalHost: "pixelblastermedia.com",
  vercelEnvironment: "production",
  pathname: "/book",
};

test("production browser requests on every noncanonical host redirect to the canonical host", () => {
  assert.equal(
    canonicalHostAction({ ...base, host: "pixel-blaster-media.vercel.app", method: "GET" }),
    "redirect",
  );
  assert.equal(
    canonicalHostAction({ ...base, host: "pixel-blaster-media.vercel.app:443", method: "HEAD" }),
    "redirect",
  );
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media-abc123.vercel.app",
      method: "GET",
    }),
    "redirect",
  );
  assert.equal(
    canonicalHostAction({ ...base, host: "legacy.example.com", method: "GET" }),
    "redirect",
  );
});

test("the canonical marketing proxy can reach the app through its stable upstream host", () => {
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media.vercel.app",
      forwardedHost: "pixelblastermedia.com",
      productionProxyHost: "pixel-blaster-media.vercel.app",
      trustedProductionProxy: true,
      method: "GET",
    }),
    "pass",
  );
});

test("direct stable-host requests cannot promote spoofed forwarding headers into proxy proof", () => {
  for (const [method, expected] of [
    ["GET", "redirect"],
    ["POST", "reject"],
  ]) {
    assert.equal(
      canonicalHostAction({
        ...base,
        host: "pixel-blaster-media.vercel.app",
        forwardedHost: "pixelblastermedia.com",
        productionProxyHost: "pixel-blaster-media.vercel.app",
        trustedProductionProxy: false,
        method,
      }),
      expected,
    );
  }
});

test("a noncanonical public proxy host redirects to the configured canonical domain", () => {
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media.vercel.app",
      forwardedHost: "www.pixelblastermedia.com",
      productionProxyHost: "pixel-blaster-media.vercel.app",
      method: "GET",
    }),
    "redirect",
  );
});

test("generated deployments cannot become trusted proxies by forging a forwarded host", () => {
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media-abc123.vercel.app",
      forwardedHost: "pixelblastermedia.com",
      productionProxyHost: "pixel-blaster-media.vercel.app",
      method: "GET",
    }),
    "redirect",
  );
});

test("same-origin rewrites require attestation even for Next assets", () => {
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media.vercel.app",
      productionProxyHost: "pixel-blaster-media.vercel.app",
      method: "GET",
      pathname: "/_next/static/chunks/app.js",
    }),
    "redirect",
  );
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media.vercel.app",
      forwardedHost: "pixelblastermedia.com",
      productionProxyHost: "pixel-blaster-media.vercel.app",
      trustedProductionProxy: true,
      method: "GET",
      pathname: "/_next/static/chunks/app.js",
    }),
    "pass",
  );
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media-abc123.vercel.app",
      forwardedHost: "pixelblastermedia.com",
      productionProxyHost: "pixel-blaster-media.vercel.app",
      trustedProductionProxy: true,
      method: "GET",
      pathname: "/_next/static/chunks/app.js",
    }),
    "redirect",
  );
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media.vercel.app",
      productionProxyHost: "pixel-blaster-media.vercel.app",
      method: "POST",
      pathname: "/_next/static/chunks/app.js",
    }),
    "reject",
  );
});

test("production non-idempotent requests cannot use noncanonical Vercel hosts", () => {
  assert.equal(
    canonicalHostAction({ ...base, host: "pixel-blaster-media.vercel.app", method: "POST" }),
    "reject",
  );
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media-abc123.vercel.app",
      method: "POST",
    }),
    "reject",
  );
  assert.equal(
    canonicalHostAction({ ...base, host: "legacy.example.com", method: "PATCH" }),
    "reject",
  );
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media.vercel.app",
      method: "POST",
      pathname: "/api/cron/reminders",
    }),
    "pass",
  );
});

test("only canonical production traffic passes while preview and local environments stay reachable", () => {
  assert.equal(
    canonicalHostAction({ ...base, host: "pixelblastermedia.com", method: "POST" }),
    "pass",
  );
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "preview-123.vercel.app",
      method: "POST",
      vercelEnvironment: "preview",
    }),
    "pass",
  );
  assert.equal(
    canonicalHostAction({ ...base, host: "localhost:3000", method: "POST" }),
    "reject",
  );
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "pixel-blaster-media.vercel.app.attacker.example",
      method: "POST",
    }),
    "reject",
  );
  assert.equal(
    canonicalHostAction({
      ...base,
      host: "localhost:3000",
      method: "POST",
      vercelEnvironment: undefined,
    }),
    "pass",
  );
});
