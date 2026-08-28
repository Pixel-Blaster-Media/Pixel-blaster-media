import assert from "node:assert/strict";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const [expiryModule, cookieFamilyModule] = await Promise.all([
  tsImport("../lib/auth/session-cookie-expiry.ts", import.meta.url),
  tsImport("../lib/auth/supabase-auth-cookie-family.ts", import.meta.url),
]);
const { supabaseSessionExpiryState } = expiryModule.default ?? expiryModule;
const {
  getPresentSupabaseAuthCookieNames,
  getSupabaseAuthCookieBaseName,
  getSupabaseAuthCookieCleanupNames,
  isSupabaseAuthCookieName,
} = cookieFamilyModule.default ?? cookieFamilyModule;

const supabaseUrl = "https://project-ref.supabase.co";
const cookieName = "sb-project-ref-auth-token";
const now = 1_800_000_000;

function encodedSession(expiresAt) {
  const json = JSON.stringify({
    access_token: "opaque.access.token",
    refresh_token: "opaque-refresh-token",
    expires_at: expiresAt,
  });
  return `base64-${Buffer.from(json).toString("base64url")}`;
}

function encodedSessionValue(value) {
  return `base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}

test("configured Auth-cookie ownership is canonical and bounded", () => {
  assert.equal(getSupabaseAuthCookieBaseName(supabaseUrl), cookieName);
  assert.equal(getSupabaseAuthCookieBaseName("not a URL"), null);

  for (const name of [
    cookieName,
    `${cookieName}.0`,
    `${cookieName}.1`,
    `${cookieName}.64`,
  ]) {
    assert.equal(isSupabaseAuthCookieName(name, cookieName), true, name);
  }
  for (const name of [
    `${cookieName}.01`,
    `${cookieName}.65`,
    `${cookieName}.999999999999999999999999999999`,
    `${cookieName}.code-verifier`,
    "sb-other-project-auth-token.0",
  ]) {
    assert.equal(isSupabaseAuthCookieName(name, cookieName), false, name);
  }

  const cleanupNames = getSupabaseAuthCookieCleanupNames(cookieName);
  assert.equal(cleanupNames.length, 66);
  assert.equal(new Set(cleanupNames).size, 66);
  assert.equal(cleanupNames[0], cookieName);
  assert.equal(cleanupNames.at(-1), `${cookieName}.64`);

  const present = getPresentSupabaseAuthCookieNames(
    [
      { name: cookieName, value: "primary" },
      { name: `${cookieName}.1`, value: "chunk" },
      { name: `${cookieName}.64`, value: "terminal" },
      { name: `${cookieName}.01`, value: "preserve" },
      { name: `${cookieName}.65`, value: "preserve" },
      { name: `${cookieName}.${"9".repeat(512)}`, value: "preserve" },
    ],
    cookieName,
  );
  assert.deepEqual(present, [
    cookieName,
    `${cookieName}.1`,
    `${cookieName}.64`,
  ]);
});

test("noncanonical prefixed cookies do not become local session evidence", () => {
  for (const name of [
    `${cookieName}.01`,
    `${cookieName}.65`,
    `${cookieName}.${"9".repeat(512)}`,
    `${cookieName}.code-verifier`,
  ]) {
    assert.equal(
      supabaseSessionExpiryState(
        [{ name, value: "attacker-controlled" }],
        supabaseUrl,
        now,
      ),
      "missing",
      name,
    );
  }
});

test("classifies fresh and near-expiry Supabase session cookies without trusting identity", () => {
  assert.equal(
    supabaseSessionExpiryState(
      [{ name: cookieName, value: encodedSession(now + 121) }],
      supabaseUrl,
      now,
    ),
    "fresh",
  );
  assert.equal(
    supabaseSessionExpiryState(
      [{ name: cookieName, value: encodedSession(now + 120) }],
      supabaseUrl,
      now,
    ),
    "near_expiry",
  );
  assert.equal(
    supabaseSessionExpiryState(
      [{ name: cookieName, value: encodedSession(now + 75) }],
      supabaseUrl,
      now,
    ),
    "near_expiry",
    "middleware must stay ahead of auth-js's locked 90-second refresh margin",
  );
  assert.equal(
    supabaseSessionExpiryState(
      [{ name: cookieName, value: encodedSession(now - 1) }],
      supabaseUrl,
      now,
    ),
    "near_expiry",
  );
});

test("reassembles bounded contiguous Supabase cookie chunks", () => {
  const encoded = encodedSession(now - 1);
  const split = Math.floor(encoded.length / 2);
  assert.equal(
    supabaseSessionExpiryState(
      [
        { name: `${cookieName}.0`, value: encoded.slice(0, split) },
        { name: `${cookieName}.1`, value: encoded.slice(split) },
      ],
      supabaseUrl,
      now,
    ),
    "near_expiry",
  );
});

test("rejects mixed primary and canonical chunk representations", () => {
  const primary = { name: cookieName, value: encodedSession(now + 121) };
  for (const residue of [
    { name: `${cookieName}.0`, value: "stale" },
    { name: `${cookieName}.64`, value: "terminal" },
  ]) {
    assert.equal(
      supabaseSessionExpiryState([primary, residue], supabaseUrl, now),
      "unreadable",
      residue.name,
    );
  }
  assert.equal(
    supabaseSessionExpiryState(
      [primary, { name: `${cookieName}.65`, value: "preserve" }],
      supabaseUrl,
      now,
    ),
    "fresh",
    "noncanonical aliases do not become configured-family session evidence",
  );
});

test("malformed, ambiguous, oversized, and unrelated cookies are never refresh triggers", () => {
  assert.equal(supabaseSessionExpiryState([], supabaseUrl, now), "missing");
  assert.equal(
    supabaseSessionExpiryState(
      [{ name: cookieName, value: "base64-not-valid-json" }],
      supabaseUrl,
      now,
    ),
    "unreadable",
  );
  assert.equal(
    supabaseSessionExpiryState(
      [{ name: `${cookieName}.1`, value: encodedSession(now - 1) }],
      supabaseUrl,
      now,
    ),
    "unreadable",
    "an orphan numeric chunk is terminal malformed state, not a missing session",
  );
  assert.equal(
    supabaseSessionExpiryState(
      [{ name: cookieName, value: "x".repeat(65_537) }],
      supabaseUrl,
      now,
    ),
    "unreadable",
  );
  assert.equal(
    supabaseSessionExpiryState(
      [{ name: cookieName, value: encodedSession("soon") }],
      supabaseUrl,
      now,
    ),
    "unreadable",
  );
  for (const malformedSession of [
    {
      access_token: "opaque.access.token",
      refresh_token: "opaque-refresh-token",
      expires_at: now + 3_600,
      user: "bad",
    },
    {
      access_token: 7,
      refresh_token: "opaque-refresh-token",
      expires_at: now + 3_600,
    },
    {
      access_token: "opaque.access.token",
      refresh_token: [],
      expires_at: now + 3_600,
    },
    {
      access_token: "opaque.access.token",
      refresh_token: "opaque-refresh-token",
      token_type: "mac",
      expires_at: now + 3_600,
    },
  ]) {
    assert.equal(
      supabaseSessionExpiryState(
        [{ name: cookieName, value: encodedSessionValue(malformedSession) }],
        supabaseUrl,
        now,
      ),
      "unreadable",
      JSON.stringify(malformedSession),
    );
  }
  assert.equal(
    supabaseSessionExpiryState(
      [{ name: cookieName, value: encodedSession(now - 1) }],
      "not a URL",
      now,
    ),
    "unreadable",
  );
});
