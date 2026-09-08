import assert from "node:assert/strict";
import test from "node:test";
import { fixture, load, root } from "./public-inbox-proof.test.mjs";
import { resolve } from "node:path";

test("password success returns a safe document destination after installing the verified session", async () => {
  const f = fixture();
  const action = load(
    resolve(root, "app/auth/password/actions.ts"),
    f.mocks,
  ).signInWithPassword;
  const form = new FormData();
  form.set("email", "controlled@example.test");
  form.set("password", "controlled-password");
  form.set("next", "/portal/property-1");
  assert.deepEqual(await action(null, form), {
    redirectTo: "/portal/property-1",
  });
  assert.deepEqual(f.effects, ["password", "cookie"]);
});
test("password destinations cannot become external document navigations", async () => {
  for (const next of [
    "https://attacker.invalid/",
    "//attacker.invalid/",
    "javascript:alert(1)",
  ]) {
    const f = fixture();
    const action = load(
      resolve(root, "app/auth/password/actions.ts"),
      f.mocks,
    ).signInWithPassword;
    const form = new FormData();
    form.set("email", "controlled@example.test");
    form.set("password", "controlled-password");
    form.set("next", next);
    assert.deepEqual(await action(null, form), {
      redirectTo: "/auth/continue",
    });
  }
});

test("password verification failure never returns a navigation destination", async () => {
  const f = fixture();
  f.mocks["@/lib/auth/set-session-cookie"].setSupabaseSessionCookie =
    async () => {
      throw new Error("fixture verification failure");
    };
  const action = load(
    resolve(root, "app/auth/password/actions.ts"),
    f.mocks,
  ).signInWithPassword;
  const form = new FormData();
  form.set("email", "controlled@example.test");
  form.set("password", "controlled-password");
  const result = await action(null, form);
  assert.equal(result.redirectTo, undefined);
  assert.equal(
    result.error,
    "The authenticated session could not be established.",
  );
});

test("post-commit session failure returns a receipt destination, not a retryable booking error", async () => {
  const f = fixture();
  await f.action(null, f.form);
  f.form.set("verification_code", f.inbox[0].text.match(/\b\d{8}\b/)[0]);
  f.mocks["@/lib/auth/set-session-cookie"].setSupabaseSessionCookie =
    async () => {
      throw Error("fixture unavailable");
    };
  const result = await f.action(null, f.form);
  assert.equal(result.ok, true);
  assert.match(result.redirectTo, /^\/book\/success\?/);
  assert.equal(f.effects.filter((x) => x === "booking").length, 1);
  assert.equal(result.errors, undefined);
});
