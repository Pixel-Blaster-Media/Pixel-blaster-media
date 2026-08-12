import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  filterIntegrationCredentialFieldNames,
  filterIntegrationCredentialFields,
  isIntegrationCredentialProvider,
} from "../lib/integrations/credential-policy.ts";
import { resolveAutoHDRClient } from "../lib/integrations/autohdr/client-core.ts";
import {
  parseProviderEnabled,
  providerEnabledField,
  resolveProviderEnabled,
} from "../lib/integrations/provider-enablement-core.ts";

const settings = readFileSync(
  new URL("../app/admin/settings/integrations/page.tsx", import.meta.url),
  "utf8",
);

test("AutoHDR credential policy accepts only its API key and enablement state", () => {
  assert.equal(isIntegrationCredentialProvider("autohdr"), true);
  assert.equal(isIntegrationCredentialProvider("autohdr-lookalike"), false);
  assert.deepEqual(
    filterIntegrationCredentialFields("autohdr", {
      api_key: "tenant-secret",
      enabled: "true",
      webhook_secret: "must-not-pass",
      organization_id: "other-tenant",
    }),
    { api_key: "tenant-secret", enabled: "true" },
  );
  assert.deepEqual(
    filterIntegrationCredentialFieldNames("autohdr", [
      "api_key",
      "enabled",
      "webhook_secret",
      "organization_id",
    ]),
    ["api_key", "enabled"],
  );
});

test("photo provider enablement is explicit, tenant-bound, and off by default", async () => {
  assert.equal(parseProviderEnabled(null), false);
  assert.equal(parseProviderEnabled("false"), false);
  assert.equal(parseProviderEnabled("TRUE"), true);
  assert.deepEqual(providerEnabledField(true), { enabled: "true" });
  const calls = [];
  assert.equal(
    await resolveProviderEnabled({
      provider: "autoenhance",
      organizationId: "organization-a",
      envVar: "AUTOENHANCE_ENABLED",
      getCredential: async (...args) => {
        calls.push(args);
        return "true";
      },
    }),
    true,
  );
  assert.deepEqual(calls, [[
    "autoenhance",
    "enabled",
    "AUTOENHANCE_ENABLED",
    "organization-a",
  ]]);
});

test("AutoHDR client resolution carries the exact tenant and credential tuple", async () => {
  const calls = [];
  await resolveAutoHDRClient({
    organizationId: "organization-a",
    getCredential: async (...args) => {
      calls.push(args);
      return "tenant-secret";
    },
  });
  assert.deepEqual(calls, [
    ["autohdr", "api_key", "AUTOHDR_API_KEY", "organization-a"],
  ]);
});

test("AutoHDR client resolution fails closed without a tenant credential", async () => {
  await assert.rejects(
    resolveAutoHDRClient({
      organizationId: "organization-b",
      getCredential: async () => null,
    }),
    /not configured/i,
  );
});

test("AutoHDR settings render only source metadata and never read the secret", () => {
  assert.match(settings, /getCredentialSource\(\s*"autohdr",\s*"api_key",\s*"AUTOHDR_API_KEY"/);
  assert.match(settings, /provider="autohdr"/);
  assert.match(settings, /On · gated/);
  assert.doesNotMatch(settings, /getCredential\(\s*"autohdr",\s*"api_key"/);
});
