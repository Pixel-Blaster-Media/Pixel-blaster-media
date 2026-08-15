import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, root), "utf8");
}

test("successful password changes land on a stable confirmation route before workspace resolution", () => {
  const action = source("app/auth/reset/confirm/actions.ts");
  assert.match(action, /redirect\("\/auth\/password-updated"\)/);
  assert.doesNotMatch(action, /password_updated=1/);
});

test("password confirmation always offers authoritative account routing", () => {
  const confirmation = source("app/auth/password-updated/page.tsx");

  assert.match(confirmation, /href="\/auth\/continue"/);
  assert.match(confirmation, /Continue to workspace/);
  assert.doesNotMatch(confirmation, /searchParams/);
  assert.doesNotMatch(confirmation, /safePostAuthPath/);
});

test("unexpected routes use the current theme and never strand an authenticated user", () => {
  const notFound = source("app/not-found.tsx");

  assert.match(notFound, /realtor-theme/);
  assert.match(notFound, /bg-realtor-bg/);
  assert.match(notFound, /href="\/auth\/continue"/);
  assert.match(notFound, /Continue to workspace/);
  assert.match(notFound, /href="\/auth\/sign-in\?audience=company&amp;next=%2Fadmin"/);
  assert.doesNotMatch(notFound, /bg-ink-soft/);
  assert.doesNotMatch(notFound, /text-brand-light/);
});
