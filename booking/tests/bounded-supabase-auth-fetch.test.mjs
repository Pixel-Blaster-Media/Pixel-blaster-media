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
const AUTH_TOKEN_URL = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;

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

test("only refresh grants enter the cookie transaction and rejected proof fails closed", async () => {
  const candidates = [];
  const proofs = [];
  const tokenBody = {
    access_token: "returned-access-token",
    refresh_token: "returned-refresh-token",
    token_type: "bearer",
    expires_in: 3_600,
    user: { id: "user-1" },
  };
  const boundedFetch = createBoundedSupabaseAuthFetch(
    SUPABASE_URL,
    async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.pathname === "/auth/v1/user"
        ? Response.json({ id: "user-1" })
        : Response.json(tokenBody);
    },
    {
      timeoutMs: 100,
      maxResponseBytes: 1_024,
      onRefreshTokenCandidate: (candidate) => candidates.push(candidate),
      onAuthUserProof: (proof) => {
        proofs.push(proof);
        return false;
      },
    },
  );

  assert.equal((await boundedFetch(AUTH_TOKEN_URL)).status, 200);
  assert.deepEqual(candidates, [
    {
      accessToken: tokenBody.access_token,
      refreshToken: tokenBody.refresh_token,
      userId: tokenBody.user.id,
    },
  ]);

  assert.equal(
    (
      await boundedFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
      })
    ).status,
    200,
  );
  assert.equal(candidates.length, 1, "password grants must not be staged");

  const rejectedProof = await boundedFetch(AUTH_USER_URL, {
    headers: { authorization: `Bearer ${tokenBody.access_token}` },
  });
  assert.equal(rejectedProof.status, 500);
  assert.deepEqual(await rejectedProof.json(), {
    code: "auth_transport_unavailable",
    error_code: "auth_transport_unavailable",
    message: "Authentication service unavailable.",
  });
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].accessToken, tokenBody.access_token);
  assert.equal(proofs[0].ok, true);
});

test("refresh-token exchanges use the same bounded Auth transport", async () => {
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
  const response = await boundedFetch(AUTH_TOKEN_URL, { method: "POST" });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    code: "auth_transport_unavailable",
    error_code: "auth_transport_unavailable",
    message: "Authentication service unavailable.",
  });
});

test("terminal Auth bodies are replaced before auth-js can log upstream content", async () => {
  const sentinel = "SENTINEL_SECRET_RESPONSE_BODY";
  const failures = [];
  const boundedFetch = createBoundedSupabaseAuthFetch(
    SUPABASE_URL,
    async () =>
      new Response(
        JSON.stringify({
          code: "refresh_token_not_found",
          message: sentinel,
          token: sentinel,
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    {
      timeoutMs: 100,
      maxResponseBytes: 1024,
      onTokenExchangeFailure: (kind) => failures.push(kind),
    },
  );

  const response = await boundedFetch(AUTH_TOKEN_URL, { method: "POST" });
  const body = await response.text();
  assert.equal(response.status, 400);
  assert.equal(body.includes(sentinel), false);
  assert.deepEqual(JSON.parse(body), {
    code: "invalid_refresh_token",
    message: "Authentication session is invalid.",
  });
  assert.deepEqual(failures, ["terminal"]);
});

test("non-target Auth endpoints pass through unchanged", async () => {
  const upstream = Response.json(
    { code: "provider_error", message: "provider body" },
    { status: 400 },
  );
  let receivedSignal;
  const boundedFetch = createBoundedSupabaseAuthFetch(
    SUPABASE_URL,
    async (_input, init) => {
      receivedSignal = init?.signal;
      return upstream;
    },
    { timeoutMs: 20, maxResponseBytes: 1 },
  );

  const response = await boundedFetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
  });
  assert.equal(response, upstream);
  assert.equal(receivedSignal, undefined);
  assert.deepEqual(await response.json(), {
    code: "provider_error",
    message: "provider body",
  });
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
