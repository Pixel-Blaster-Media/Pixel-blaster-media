import assert from "node:assert/strict";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const exchangeModule = await tsImport(
  "../lib/auth/supabase-refresh-exchange.ts",
  import.meta.url,
);
const exports = exchangeModule.default ?? exchangeModule;
const { exchangeSupabaseRefreshToken } = exports;

const config = {
  supabaseUrl: "https://project.supabase.co",
  anonKey: "public-anon-key",
};

test("refresh exchange proves the supplied token through Supabase Auth", async () => {
  let request;
  const result = await exchangeSupabaseRefreshToken("refresh-token", {
    ...config,
    fetcher: async (url, init) => {
      request = { url: String(url), init };
      return new Response(
        JSON.stringify({
          access_token: "verified.access.token",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  assert.deepEqual(result, {
    ok: true,
    tokens: {
      access_token: "verified.access.token",
      refresh_token: "rotated-refresh-token",
      expires_in: 3600,
      token_type: "bearer",
    },
  });
  assert.equal(
    request.url,
    "https://project.supabase.co/auth/v1/token?grant_type=refresh_token",
  );
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.apikey, config.anonKey);
  assert.deepEqual(JSON.parse(request.init.body), {
    refresh_token: "refresh-token",
  });
});

test("invalid, unavailable, and malformed refresh exchanges fail closed", async () => {
  const invalid = await exchangeSupabaseRefreshToken("bad-token", {
    ...config,
    fetcher: async () => new Response("rejected", { status: 401 }),
  });
  assert.deepEqual(invalid, { ok: false, kind: "invalid" });

  const unavailable = await exchangeSupabaseRefreshToken("refresh-token", {
    ...config,
    fetcher: async () => {
      throw new Error("network details must not escape");
    },
  });
  assert.deepEqual(unavailable, { ok: false, kind: "unavailable" });

  const malformed = await exchangeSupabaseRefreshToken("refresh-token", {
    ...config,
    fetcher: async () =>
      new Response(JSON.stringify({ access_token: "only-one-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  assert.deepEqual(malformed, { ok: false, kind: "malformed" });
});

test("oversized Supabase success bodies fail closed before token use", async () => {
  const result = await exchangeSupabaseRefreshToken("refresh-token", {
    ...config,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          access_token: "verified.access.token",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
          padding: "x".repeat(70_000),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  assert.deepEqual(result, { ok: false, kind: "malformed" });
});

test("oversized refresh responses do not await stalled stream cancellation", async () => {
  let cancelCalled = false;
  const responseBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(70_000));
    },
    cancel() {
      cancelCalled = true;
      return new Promise(() => {});
    },
  });
  const result = await Promise.race([
    exchangeSupabaseRefreshToken("refresh-token", {
      ...config,
      fetcher: async () =>
        new Response(responseBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    }),
    new Promise((resolve) => setTimeout(() => resolve("timed_out"), 100)),
  ]);
  assert.deepEqual(result, { ok: false, kind: "malformed" });
  assert.equal(cancelCalled, true);
});

test("oversized refresh tokens are rejected before network access", async () => {
  let called = false;
  const result = await exchangeSupabaseRefreshToken("x".repeat(16_385), {
    ...config,
    fetcher: async () => {
      called = true;
      return new Response("{}");
    },
  });
  assert.deepEqual(result, { ok: false, kind: "invalid" });
  assert.equal(called, false);
});
