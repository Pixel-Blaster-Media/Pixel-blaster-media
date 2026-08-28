import assert from "node:assert/strict";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import { tsImport } from "tsx/esm/api";

const adapterModule = await tsImport(
  "../lib/auth/supabase-server-cookie-adapter.ts",
  import.meta.url,
);
const { getSupabaseSdkCookieMutations, getSupabaseSdkVisibleCookies } =
  adapterModule.default ?? adapterModule;

const supabaseUrl = "https://project-ref.supabase.co";
const authBase = "sb-project-ref-auth-token";
const codeVerifierBase = `${authBase}-code-verifier`;
const userStorageBase = `${authBase}-user`;

function encodedSession(expiresAt = 2_000_000_000) {
  return `base64-${Buffer.from(
    JSON.stringify({
      access_token: "opaque.access.token",
      refresh_token: "opaque-refresh-token",
      expires_at: expiresAt,
    }),
  ).toString("base64url")}`;
}

test("the Supabase SDK sees only canonical configured storage cookies", () => {
  const longAlias = `${authBase}.${"9".repeat(512)}`;
  const visible = getSupabaseSdkVisibleCookies(
    [
      { name: authBase, value: encodedSession() },
      { name: `${authBase}.01`, value: "preserve-leading-zero" },
      { name: `${authBase}.65`, value: "preserve-high" },
      { name: longAlias, value: "preserve-long" },
      { name: `${authBase}-adjacent`, value: "preserve-adjacent" },
      { name: codeVerifierBase, value: "verifier" },
      { name: `${codeVerifierBase}.65`, value: "preserve-verifier-high" },
      { name: userStorageBase, value: "separate-user" },
      { name: `${userStorageBase}.65`, value: "preserve-user-high" },
      { name: "application-preference", value: "preserve-unrelated" },
    ],
    supabaseUrl,
  );

  assert.deepEqual(visible, [
    { name: authBase, value: encodedSession() },
    { name: codeVerifierBase, value: "verifier" },
    { name: userStorageBase, value: "separate-user" },
  ]);
});

test("SDK cookie writes preserve unowned names and emit only bounded canonical names", () => {
  const longAlias = `${authBase}.${"8".repeat(512)}`;
  const options = { path: "/", sameSite: "lax" };
  const observed = [
    { name: `${authBase}.0`, value: "old-0" },
    { name: `${authBase}.1`, value: "old-1" },
    { name: `${authBase}.2`, value: "old-2" },
    { name: `${authBase}.64`, value: "terminal" },
    { name: `${authBase}.01`, value: "preserve-leading-zero" },
    { name: `${authBase}.65`, value: "preserve-high" },
    { name: longAlias, value: "preserve-long" },
    { name: codeVerifierBase, value: "old-verifier" },
  ];
  const safe = getSupabaseSdkCookieMutations(
    observed,
    [
      { name: `${authBase}.2`, value: "", options },
      { name: `${authBase}.64`, value: "", options },
      { name: `${authBase}.01`, value: "", options },
      { name: `${authBase}.65`, value: "", options },
      { name: longAlias, value: "", options },
      { name: `${authBase}.0`, value: "new-0", options },
      { name: `${authBase}.1`, value: "new-1", options },
      { name: codeVerifierBase, value: "", options },
    ],
    supabaseUrl,
  );

  assert.deepEqual(
    safe.map(({ name, value }) => ({ name, value })),
    [
      { name: `${authBase}.2`, value: "" },
      { name: `${authBase}.64`, value: "" },
      { name: `${authBase}.0`, value: "new-0" },
      { name: `${authBase}.1`, value: "new-1" },
      { name: codeVerifierBase, value: "" },
    ],
  );
  assert.equal(safe.every((mutation) => mutation.options === options), true);
});

test("a positive SDK session write clears hidden canonical residue before replacement", () => {
  const sessionValue = encodedSession();
  const options = { path: "/", sameSite: "lax", httpOnly: true };
  const safe = getSupabaseSdkCookieMutations(
    [
      { name: `${authBase}.0`, value: "malformed-hidden-chunk" },
      { name: `${authBase}.64`, value: "terminal-hidden-residue" },
      { name: `${authBase}.01`, value: "preserve-leading-zero" },
      { name: codeVerifierBase, value: "pkce-verifier" },
    ],
    [
      { name: authBase, value: sessionValue, options },
      {
        name: codeVerifierBase,
        value: "",
        options: { ...options, maxAge: 0 },
      },
    ],
    supabaseUrl,
  );

  assert.deepEqual(
    safe.map(({ name, value, options: mutationOptions }) => ({
      name,
      value,
      maxAge: mutationOptions.maxAge,
    })),
    [
      { name: `${authBase}.0`, value: "", maxAge: 0 },
      { name: `${authBase}.64`, value: "", maxAge: 0 },
      { name: authBase, value: sessionValue, maxAge: undefined },
      { name: codeVerifierBase, value: "", maxAge: 0 },
    ],
  );
});

test("a locked SDK PKCE exchange removes hidden canonical residue end to end", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
  const encodeJwtPart = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${encodeJwtPart({ alg: "HS256", typ: "JWT" })}.${encodeJwtPart({
    aud: "authenticated",
    exp: expiresAt,
    sub: userId,
  })}.pkce-test-signature`;
  const session = {
    access_token: accessToken,
    refresh_token: "pkce-rotated-refresh-token",
    token_type: "bearer",
    expires_in: 3_600,
    expires_at: expiresAt,
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "pkce@example.invalid",
      app_metadata: {},
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
    },
  };
  const jar = new Map([
    [`${authBase}.0`, "malformed-hidden-chunk"],
    [`${authBase}.64`, "terminal-hidden-residue"],
    [`${authBase}.01`, "preserve-noncanonical"],
    [codeVerifierBase, "locked-pkce-verifier"],
  ]);
  const committed = [];
  const client = createServerClient(supabaseUrl, "test-anon-key", {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.pathname, "/auth/v1/token");
        assert.equal(url.searchParams.get("grant_type"), "pkce");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          auth_code: "locked-auth-code",
          code_verifier: "locked-pkce-verifier",
        });
        return Response.json(session);
      },
    },
    cookies: {
      getAll() {
        return getSupabaseSdkVisibleCookies(
          [...jar].map(([name, value]) => ({ name, value })),
          supabaseUrl,
        );
      },
      setAll(requestedMutations) {
        const safe = getSupabaseSdkCookieMutations(
          [...jar].map(([name, value]) => ({ name, value })),
          requestedMutations,
          supabaseUrl,
        );
        committed.push(...safe);
        for (const mutation of safe) {
          if (!mutation.value || mutation.options.maxAge === 0) {
            jar.delete(mutation.name);
          } else {
            jar.set(mutation.name, mutation.value);
          }
        }
      },
    },
  });

  const result = await client.auth.exchangeCodeForSession("locked-auth-code");
  assert.equal(result.error, null);
  assert.equal(result.data.session?.access_token, accessToken);
  assert.equal(jar.has(`${authBase}.0`), false);
  assert.equal(jar.has(`${authBase}.64`), false);
  assert.equal(jar.has(codeVerifierBase), false);
  assert.equal(jar.get(`${authBase}.01`), "preserve-noncanonical");
  assert.ok(jar.get(authBase), "the replacement session must be installed");
  assert.deepEqual(
    committed
      .filter((mutation) =>
        [`${authBase}.0`, `${authBase}.64`].includes(mutation.name),
      )
      .map(({ name, value, options }) => ({
        name,
        value,
        maxAge: options.maxAge,
      })),
    [
      { name: `${authBase}.0`, value: "", maxAge: 0 },
      { name: `${authBase}.64`, value: "", maxAge: 0 },
    ],
  );
});

test("SDK cookie writes fail closed on an unknown positive storage name", () => {
  assert.throws(
    () =>
      getSupabaseSdkCookieMutations(
        [],
        [
          {
            name: `${authBase}-attacker-controlled`,
            value: "positive-value",
            options: { path: "/" },
          },
        ],
        supabaseUrl,
      ),
    /unsafe Supabase cookie mutation/i,
  );
});

test("SDK cookie families enforce the shared encoded-session limit", () => {
  const oversizedValue = "x".repeat(65_537);
  assert.deepEqual(
    getSupabaseSdkVisibleCookies(
      [{ name: codeVerifierBase, value: oversizedValue }],
      supabaseUrl,
    ),
    [],
  );
  assert.throws(
    () =>
      getSupabaseSdkCookieMutations(
        [],
        [
          {
            name: authBase,
            value: oversizedValue,
            options: { path: "/" },
          },
        ],
        supabaseUrl,
      ),
    /unsafe Supabase cookie mutation/i,
  );
});
