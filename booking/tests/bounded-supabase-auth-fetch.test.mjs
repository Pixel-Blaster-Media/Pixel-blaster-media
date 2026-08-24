import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { tsImport } from "tsx/esm/api";

const authFetchModule = await tsImport(
  "../lib/auth/bounded-supabase-auth-fetch.ts",
  import.meta.url,
);
const { createBoundedSupabaseAuthFetch } =
  authFetchModule.default ?? authFetchModule;
const verifiedTokenModule = await tsImport(
  "../lib/auth/verified-access-token.ts",
  import.meta.url,
);
const { AuthTokenVerificationError, requireVerifiedAccessToken } =
  verifiedTokenModule.default ?? verifiedTokenModule;

const SUPABASE_URL = "https://project-ref.supabase.co";
const AUTH_USER_URL = `${SUPABASE_URL}/auth/v1/user`;

test("auth user verification has a hard request deadline", async () => {
  const stalledFetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => reject(init.signal.reason),
        { once: true },
      );
    });
  const boundedFetch = createBoundedSupabaseAuthFetch(
    SUPABASE_URL,
    stalledFetch,
    { timeoutMs: 20, maxResponseBytes: 1024 },
  );

  const startedAt = Date.now();
  await assert.rejects(
    boundedFetch(AUTH_USER_URL),
    /authentication verification request failed/i,
  );
  assert.ok(Date.now() - startedAt < 500, "deadline did not abort promptly");
});

test("Supabase Auth maps a verifier deadline to fail-closed unavailability", async () => {
  const stalledFetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => reject(init.signal.reason),
        { once: true },
      );
    });
  const client = createClient(SUPABASE_URL, "public-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: createBoundedSupabaseAuthFetch(SUPABASE_URL, stalledFetch, {
        timeoutMs: 20,
        maxResponseBytes: 1024,
      }),
    },
  });

  const originalConsoleError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args.map(String).join(" "));
  try {
    await assert.rejects(
      requireVerifiedAccessToken("syntactically-bounded-token", (token) =>
        client.auth.getUser(token),
      ),
      (error) =>
        error instanceof AuthTokenVerificationError &&
        error.kind === "unavailable",
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.ok(
    loggedErrors.every((entry) =>
      entry.includes("Authentication verification request failed"),
    ),
  );
});

test("the deadline covers a response body that stalls after headers", async () => {
  let cancelCalled = false;
  const boundedFetch = createBoundedSupabaseAuthFetch(
    SUPABASE_URL,
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"id":'));
          },
          cancel() {
            cancelCalled = true;
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    { timeoutMs: 20, maxResponseBytes: 1024 },
  );

  await assert.rejects(
    boundedFetch(AUTH_USER_URL),
    /authentication verification request failed/i,
  );
  assert.equal(cancelCalled, true);
});

test("caller aborts are forwarded into bounded authentication verification", async () => {
  const controller = new AbortController();
  const boundedFetch = createBoundedSupabaseAuthFetch(
    SUPABASE_URL,
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), {
          once: true,
        });
      }),
    { timeoutMs: 1_000, maxResponseBytes: 1024 },
  );
  const result = assert.rejects(
    boundedFetch(AUTH_USER_URL, { signal: controller.signal }),
    /authentication verification request failed/i,
  );
  controller.abort();
  await result;
});

test("oversized declared auth responses are rejected before parsing", async () => {
  const boundedFetch = createBoundedSupabaseAuthFetch(
    SUPABASE_URL,
    async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "2048",
        },
      }),
    { timeoutMs: 100, maxResponseBytes: 1024 },
  );
  await assert.rejects(
    boundedFetch(AUTH_USER_URL),
    /authentication verification response is too large/i,
  );
});

test("auth user responses are byte-bounded before Supabase can parse JSON", async () => {
  const upstream = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const boundedFetch = createBoundedSupabaseAuthFetch(
    SUPABASE_URL,
    async () => upstream,
    { timeoutMs: 100, maxResponseBytes: 8 },
  );

  await assert.rejects(
    boundedFetch(AUTH_USER_URL),
    /authentication verification response is too large/i,
  );
});

test("bounded auth responses preserve status, headers, and parseable bytes", async () => {
  const body = JSON.stringify({ id: "user-1" });
  const boundedFetch = createBoundedSupabaseAuthFetch(
    SUPABASE_URL,
    async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/json", "x-auth": "verified" },
      }),
    { timeoutMs: 100, maxResponseBytes: 1024 },
  );

  const response = await boundedFetch(AUTH_USER_URL);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-auth"), "verified");
  assert.deepEqual(await response.json(), { id: "user-1" });
});

test("non-auth Supabase traffic is passed through without buffering", async () => {
  const upstream = new Response("database-response", { status: 200 });
  let receivedSignal;
  const boundedFetch = createBoundedSupabaseAuthFetch(
    SUPABASE_URL,
    async (_input, init) => {
      receivedSignal = init?.signal;
      return upstream;
    },
    { timeoutMs: 20, maxResponseBytes: 1 },
  );

  const response = await boundedFetch(`${SUPABASE_URL}/rest/v1/profiles`);
  assert.equal(response, upstream);
  assert.equal(receivedSignal, undefined);
  assert.equal(await response.text(), "database-response");
});
