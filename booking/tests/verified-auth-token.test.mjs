import assert from "node:assert/strict";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const verifiedTokenModule = await tsImport(
  "../lib/auth/verified-access-token.ts",
  import.meta.url,
);
const {
  AuthTokenVerificationError,
  parseVerifiedAccessTokenClaims,
  requireVerifiedAccessToken,
} = verifiedTokenModule.default;

function unsignedToken(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "unsigned",
  ].join(".");
}

test("requireVerifiedAccessToken rejects a forged token when Supabase rejects it", async () => {
  const forged = unsignedToken({
    sub: "00000000-0000-0000-0000-000000000001",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });

  await assert.rejects(
    requireVerifiedAccessToken(forged, async () => ({
      data: { user: null },
      error: { name: "AuthApiError", message: "invalid JWT", status: 401 },
    })),
    (error) =>
      error instanceof AuthTokenVerificationError && error.kind === "invalid",
  );
});

test("requireVerifiedAccessToken classifies retryable verifier failures as unavailable", async () => {
  for (const errorResult of [
    {
      name: "AuthRetryableFetchError",
      message: "network details",
      status: 0,
    },
    { name: "AuthApiError", message: "upstream failure", status: 503 },
    { name: "AuthApiError", message: "rate limited", status: 429 },
  ]) {
    await assert.rejects(
      requireVerifiedAccessToken("signed-token", async () => ({
        data: { user: null },
        error: errorResult,
      })),
      (error) =>
        error instanceof AuthTokenVerificationError &&
        error.kind === "unavailable",
    );
  }
});

test("requireVerifiedAccessToken returns only the user verified by Supabase", async () => {
  const verifiedUser = {
    id: "00000000-0000-0000-0000-000000000002",
    aud: "authenticated",
    email: "verified@example.com",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-08-20T00:00:00.000Z",
  };

  const result = await requireVerifiedAccessToken("signed-token", async (token) => {
    assert.equal(token, "signed-token");
    return { data: { user: verifiedUser }, error: null };
  });

  assert.equal(result, verifiedUser);
});

test("verified token claims must match the verified Supabase user and be unexpired", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = unsignedToken({
    sub: "00000000-0000-0000-0000-000000000003",
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
  });

  assert.equal(
    parseVerifiedAccessTokenClaims(
      token,
      "00000000-0000-0000-0000-000000000003",
      now,
    ).sub,
    "00000000-0000-0000-0000-000000000003",
  );
  assert.throws(
    () =>
      parseVerifiedAccessTokenClaims(
        token,
        "00000000-0000-0000-0000-000000000004",
        now,
      ),
    /subject mismatch/i,
  );
  assert.throws(
    () =>
      parseVerifiedAccessTokenClaims(
        unsignedToken({
          sub: "00000000-0000-0000-0000-000000000003",
          aud: "authenticated",
          exp: now - 1,
          iat: now - 3601,
        }),
        "00000000-0000-0000-0000-000000000003",
        now,
      ),
    /expired/i,
  );
});
