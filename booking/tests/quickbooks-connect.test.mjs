import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import { getQuickBooksConnectConfiguration, quickBooksConnectErrorMessage } from "../lib/integrations/quickbooks/connect-config.ts";

const require = createRequire(import.meta.url);
const configured = {
  QUICKBOOKS_CLIENT_ID: "fixture-client",
  QUICKBOOKS_CLIENT_SECRET: "fixture-secret",
  NEXT_PUBLIC_APP_URL: "https://booking.example.invalid",
  QUICKBOOKS_ENVIRONMENT: "production",
  NODE_ENV: "production",
};

function load(path, dependencies, globals = {}) {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, URLSearchParams, console: { error() {} }, Date,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    }, ...globals,
  });
  return exports;
}

function action(env, authError) {
  const writes = [];
  const dependencies = new Proxy({
    "next/headers": { cookies: async () => ({ set: (...args) => writes.push(args) }) },
    "next/navigation": { redirect: (url) => { throw Object.assign(new Error("redirect"), { url }); } },
    "@/lib/auth/require-admin": { requireAdmin: async () => {
      if (authError) throw authError;
      return { userId: "admin-a", organizationId: "org-a" };
    } },
    "@/lib/integrations/quickbooks/connect-config": { getQuickBooksConnectConfiguration },
    "@/lib/integrations/quickbooks/oauth-state": {
      buildQuickBooksOAuthState: (user, org) => {
        assert.equal(user, "admin-a"); assert.equal(org, "org-a"); return "fixture-state";
      },
    },
    "@/lib/integrations/quickbooks/oauth": load("lib/integrations/quickbooks/oauth.ts", { "server-only": {} }),
  }, {
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
    get: (target, key) => target[key] ?? {},
  });
  return { writes, start: load("app/admin/settings/integrations/actions.ts", dependencies, { process: { env } }).startQuickBooksConnect };
}

for (const name of ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "NEXT_PUBLIC_APP_URL"]) {
  test(`missing ${name} keeps the user in Connections without a consent cookie or crash`, async () => {
    const env = { ...configured, [name]: " " };
    const config = getQuickBooksConnectConfiguration(env);
    assert.equal(config.ok, false);
    assert.match(config.message, new RegExp(name));
    assert.doesNotMatch(config.message, /fixture-client|fixture-secret/);
    const { start, writes } = action(env);
    await assert.rejects(start(), (error) => error.url === "/admin/settings/integrations?qbo_error=not_configured#quickbooks");
    assert.equal(writes.length, 0);
  });
}

for (const value of ["not-a-url", "javascript:alert(1)", "http://public.example.invalid", "https://user:password@example.invalid", "https://example.invalid?secret=test", "https://example.invalid/#fragment", "https://exam ple.invalid", "https:\\example.invalid"]) {
  test(`invalid app URL (${value.split(":")[0]}) produces safe guidance before side effects`, async () => {
    const { start, writes } = action({ ...configured, NEXT_PUBLIC_APP_URL: value });
    await assert.rejects(start(), (error) => error.url?.includes("qbo_error=invalid_app_url"));
    assert.equal(writes.length, 0);
  });
}

test("production rejects local HTTP; sandbox permits local development only", () => {
  assert.equal(getQuickBooksConnectConfiguration({ ...configured, NEXT_PUBLIC_APP_URL: "http://localhost:3000" }).ok, false);
  const sandbox = getQuickBooksConnectConfiguration({ ...configured, QUICKBOOKS_ENVIRONMENT: "sandbox", NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
  assert.equal(sandbox.ok, true);
  assert.equal(sandbox.redirectUri, "http://localhost:3000/api/integrations/quickbooks/callback");
  assert.equal(getQuickBooksConnectConfiguration({ ...configured, QUICKBOOKS_ENVIRONMENT: "live" }).code, "invalid_environment");
});

test("configured kickoff preserves tenant binding, secure cookie and exact accounting-only consent URL", async () => {
  const { start, writes } = action(configured);
  await assert.rejects(start(), (error) => {
    const url = new URL(error.url);
    assert.equal(url.origin, "https://appcenter.intuit.com");
    assert.equal(url.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
    assert.equal(url.searchParams.get("redirect_uri"), "https://booking.example.invalid/api/integrations/quickbooks/callback");
    assert.equal(url.searchParams.get("state"), "fixture-state");
    assert.equal(url.searchParams.has("client_secret"), false);
    return true;
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "qbo_oauth_state");
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0][2])), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
});

test("admin authorization is required before configuration inspection or state creation", async () => {
  const denial = new Error("admin authorization denied");
  const { start, writes } = action({}, denial);
  await assert.rejects(start(), (error) => error === denial);
  assert.equal(writes.length, 0);
});

test("callback rejects malformed configuration before token exchange or database writes", async () => {
  let deleted = 0;
  const route = load("app/api/integrations/quickbooks/callback/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => ({ value: "fixture-state" }), delete: () => { deleted++; } }) },
    "next/server": { NextResponse: { redirect: (url) => url.toString() } },
    "@/lib/auth/require-admin": { requireAdmin: async () => ({ userId: "admin-a", organizationId: "org-a" }) },
    "@/lib/integrations/quickbooks/oauth": { exchangeCodeForTokens: () => { throw new Error("must not exchange"); } },
    "@/lib/integrations/quickbooks/oauth-state": { quickBooksOAuthStateMatchesAdmin: () => true },
    "@/lib/integrations/quickbooks/connect-config": { getQuickBooksConnectConfiguration },
    "@/lib/supabase/server": { getServiceSupabase: () => { throw new Error("must not write"); } },
  }, { process: { env: { ...configured, NEXT_PUBLIC_APP_URL: "not-a-url" } } });
  const result = await route.GET({ url: "https://booking.example.invalid/api/integrations/quickbooks/callback?state=fixture-state&code=fixture-code&realmId=123" });
  assert.equal(new URL(result).searchParams.get("qbo_error"), "invalid_app_url");
  assert.equal(deleted, 1);
});

test("setup guidance disables Connect and is accessible; arbitrary provider details stay hidden", () => {
  const Button = load("app/admin/settings/integrations/ConnectButton.tsx", {
    "react": require("react"), "react/jsx-runtime": require("react/jsx-runtime"),
    "./actions": { startQuickBooksConnect() { throw new Error("must not run during rendering"); } },
  }).default;
  const markup = renderToStaticMarkup(React.createElement(Button, { configurationError: "Configure QUICKBOOKS_CLIENT_ID." }));
  assert.match(markup, /role="alert"/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-describedby="quickbooks-configuration-error"/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Button)), /disabled=""/);
  assert.doesNotMatch(quickBooksConnectErrorMessage("provider-secret-content"), /provider-secret-content/);
});

test("callback does not echo provider error text or database details containing credentials", async () => {
  const logs = [];
  const route = load("app/api/integrations/quickbooks/callback/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => ({ value: "fixture-state" }), delete() {} }) },
    "next/server": { NextResponse: { redirect: (url) => url.toString() } },
    "@/lib/auth/require-admin": { requireAdmin: async () => ({ userId: "admin-a", organizationId: "org-a" }) },
    "@/lib/integrations/quickbooks/oauth": { exchangeCodeForTokens: async () => ({ expires_in: 3600, access_token: "fixture-access", refresh_token: "fixture-refresh" }) },
    "@/lib/integrations/quickbooks/oauth-state": { quickBooksOAuthStateMatchesAdmin: () => true },
    "@/lib/integrations/quickbooks/connect-config": { getQuickBooksConnectConfiguration },
    "@/lib/supabase/server": { getServiceSupabase: () => ({ from: () => ({ upsert: async () => ({ error: { detail: "fixture-sensitive-value" } }) }) }) },
  }, { process: { env: configured }, console: { error: (...args) => logs.push(args) } });
  const base = "https://booking.example.invalid/api/integrations/quickbooks/callback?state=fixture-state&code=fixture-code&realmId=123";
  const denied = new URL(await route.GET({ url: base + "&error=access_denied" }));
  assert.equal(denied.searchParams.get("qbo_error"), "access_denied");
  const unknown = new URL(await route.GET({ url: base + "&error=fixture-sensitive-value" }));
  assert.equal(unknown.searchParams.get("qbo_error"), "authorization_failed");
  const failed = new URL(await route.GET({ url: base }));
  assert.equal(failed.searchParams.get("qbo_error"), "persist_failed");
  assert.doesNotMatch(JSON.stringify({ logs, url: unknown.href }), /fixture-sensitive-value|fixture-access|fixture-refresh/);
});
