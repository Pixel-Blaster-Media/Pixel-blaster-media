import assert from "node:assert/strict";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const bodyModule = await tsImport(
  "../lib/security/bounded-json-body.ts",
  import.meta.url,
);
const exports = bodyModule.default ?? bodyModule;
const { readBoundedJsonBody } = exports;

test("bounded JSON parsing accepts a valid application/json request", async () => {
  const request = new Request("https://pixelblastermedia.com/api/auth/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ ok: true }),
  });

  assert.deepEqual(await readBoundedJsonBody(request, 1_000), {
    ok: true,
    value: { ok: true },
  });
});

test("bounded JSON parsing rejects unsupported and malformed bodies", async () => {
  const unsupported = new Request("https://pixelblastermedia.com/api/auth/bridge", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.deepEqual(await readBoundedJsonBody(unsupported, 1_000), {
    ok: false,
    kind: "unsupported_media_type",
  });

  const malformed = new Request("https://pixelblastermedia.com/api/auth/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.deepEqual(await readBoundedJsonBody(malformed, 1_000), {
    ok: false,
    kind: "invalid_json",
  });
});

test("the actual streamed byte count enforces the limit without Content-Length", async () => {
  const request = new Request("https://pixelblastermedia.com/api/auth/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "éééééé" }),
  });
  assert.equal(request.headers.has("content-length"), false);
  assert.deepEqual(await readBoundedJsonBody(request, 12), {
    ok: false,
    kind: "too_large",
  });
});

test("oversized body rejection does not await stalled stream cancellation", async () => {
  let cancelCalled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(32));
    },
    cancel() {
      cancelCalled = true;
      return new Promise(() => {});
    },
  });
  const request = new Request("https://pixelblastermedia.com/api/auth/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  });

  const result = await Promise.race([
    readBoundedJsonBody(request, 16),
    new Promise((resolve) => setTimeout(() => resolve("timed_out"), 100)),
  ]);
  assert.deepEqual(result, { ok: false, kind: "too_large" });
  assert.equal(cancelCalled, true);
});
