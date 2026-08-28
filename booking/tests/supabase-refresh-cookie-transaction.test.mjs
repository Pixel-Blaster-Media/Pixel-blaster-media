import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const transactionModule = await tsImport(
  "../lib/auth/supabase-refresh-cookie-transaction.ts",
  import.meta.url,
);
const { createSupabaseRefreshCookieTransaction } =
  transactionModule.default ?? transactionModule;

const SUPABASE_URL = "https://project-ref.supabase.co";
const COOKIE_NAME = "sb-project-ref-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function jwt(userId, expiresAt, signature = "test-signature") {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: expiresAt,
    iat: expiresAt - 3_600,
    sub: userId,
  })}.${signature}`;
}

function fixture({ expiresAt = Math.floor(Date.now() / 1_000) + 3_600 } = {}) {
  const accessToken = jwt(USER_ID, expiresAt);
  const session = {
    access_token: accessToken,
    refresh_token: "rotated-refresh-token",
    token_type: "bearer",
    expires_at: expiresAt,
    expires_in: expiresAt - Math.floor(Date.now() / 1_000),
    user: { id: USER_ID },
  };
  const mutation = {
    name: COOKIE_NAME,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    options: { httpOnly: true, secure: true, path: "/" },
  };
  const candidate = {
    accessToken,
    refreshToken: session.refresh_token,
    userId: USER_ID,
  };
  return { accessToken, candidate, expiresAt, mutation, session };
}

function userBytes(userId = USER_ID) {
  return new TextEncoder().encode(
    JSON.stringify({
      id: userId,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    }),
  ).buffer;
}

test("refresh writes remain staged and roll back when returned-token proof fails", () => {
  const committed = [];
  const transaction = createSupabaseRefreshCookieTransaction(
    SUPABASE_URL,
    (mutations) => committed.push(...mutations),
  );
  const value = fixture();
  transaction.acceptRefreshCandidate(value.candidate);
  assert.deepEqual(transaction.processCookieMutations([value.mutation]), []);
  assert.equal(
    transaction.processAuthUserProof({
      accessToken: value.accessToken,
      bytes: null,
      ok: false,
    }),
    false,
  );
  assert.deepEqual(committed, []);
});

test("a bound user/JWT/expiry proof commits the staged batch exactly once", () => {
  const committed = [];
  const transaction = createSupabaseRefreshCookieTransaction(
    SUPABASE_URL,
    (mutations) => committed.push(...mutations),
  );
  const value = fixture();
  transaction.acceptRefreshCandidate(value.candidate);
  assert.deepEqual(transaction.processCookieMutations([value.mutation]), []);
  assert.equal(
    transaction.processAuthUserProof({
      accessToken: value.accessToken,
      bytes: userBytes(),
      ok: true,
    }),
    true,
  );
  assert.equal(
    transaction.processAuthUserProof({
      accessToken: value.accessToken,
      bytes: userBytes(),
      ok: true,
    }),
    true,
  );
  assert.deepEqual(committed, [value.mutation]);
});

test("proof for a different token with identical subject and claims never commits", () => {
  const committed = [];
  const transaction = createSupabaseRefreshCookieTransaction(
    SUPABASE_URL,
    (mutations) => committed.push(...mutations),
  );
  const value = fixture();
  const sameClaimsDifferentToken = jwt(
    USER_ID,
    value.expiresAt,
    "different-signature-bytes",
  );

  transaction.acceptRefreshCandidate(value.candidate);
  transaction.processCookieMutations([value.mutation]);
  assert.equal(
    transaction.processAuthUserProof({
      accessToken: sameClaimsDifferentToken,
      bytes: userBytes(),
      ok: true,
    }),
    false,
  );
  assert.deepEqual(committed, []);
});

test("identity and staged expiry mismatches never commit", () => {
  for (const mismatch of ["identity", "expiry"]) {
    const committed = [];
    const transaction = createSupabaseRefreshCookieTransaction(
      SUPABASE_URL,
      (mutations) => committed.push(...mutations),
    );
    const value = fixture();
    const mutation = mismatch === "expiry"
      ? {
          ...value.mutation,
          value: `base64-${Buffer.from(
            JSON.stringify({ ...value.session, expires_at: value.expiresAt + 300 }),
          ).toString("base64url")}`,
        }
      : value.mutation;
    transaction.acceptRefreshCandidate(value.candidate);
    transaction.processCookieMutations([mutation]);
    assert.equal(
      transaction.processAuthUserProof({
        accessToken: value.accessToken,
        bytes: userBytes(
          mismatch === "identity"
            ? "22222222-2222-4222-8222-222222222222"
            : USER_ID,
        ),
        ok: true,
      }),
      false,
    );
    assert.deepEqual(committed, [], mismatch);
  }
});

test("explicit writes pass through, but a failed refresh cannot delete auth cookies", () => {
  const committed = [];
  const transaction = createSupabaseRefreshCookieTransaction(
    SUPABASE_URL,
    (mutations) => committed.push(...mutations),
  );
  const value = fixture();
  const deletion = { ...value.mutation, value: "", options: { maxAge: 0 } };

  assert.deepEqual(transaction.processCookieMutations([value.mutation]), [value.mutation]);
  assert.deepEqual(transaction.processCookieMutations([deletion]), [deletion]);

  transaction.failRefresh("terminal");
  assert.deepEqual(transaction.processCookieMutations([deletion]), []);
  assert.deepEqual(committed, []);
});
