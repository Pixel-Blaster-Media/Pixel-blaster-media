import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mergeCredentialFields,
  resolveCredentialStrict,
} from "../lib/integrations/credentials-core.ts";
import { resolveProviderEnabled } from "../lib/integrations/provider-enablement-core.ts";

const bookingPage = readFileSync(
  new URL("../app/admin/bookings/[id]/page.tsx", import.meta.url),
  "utf8",
);
const mediaWorkflow = readFileSync(
  new URL("../app/admin/bookings/[id]/MediaWorkflow.tsx", import.meta.url),
  "utf8",
);
const autoenhanceWorkflow = readFileSync(
  new URL("../lib/integrations/autoenhance/workflow.ts", import.meta.url),
  "utf8",
);
const autoenhanceClient = readFileSync(
  new URL("../lib/integrations/autoenhance/client.ts", import.meta.url),
  "utf8",
);
const webhook = readFileSync(
  new URL("../app/api/integrations/autoenhance/webhook/route.ts", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../app/admin/settings/integrations/page.tsx", import.meta.url),
  "utf8",
);

test("photo provider toggles are tenant-scoped and hide disabled booking tools", () => {
  assert.match(bookingPage, /isPhotoEditingProviderEnabled\("autohdr", admin\.organizationId\)/);
  assert.match(bookingPage, /isPhotoEditingProviderEnabled\("autoenhance", admin\.organizationId\)/);
  assert.match(bookingPage, /autoenhanceEnabled\s*\?\s*listBookingAutoenhanceBatches/);
  assert.match(mediaWorkflow, /autoHDREnabled \? \(/);
  assert.match(mediaWorkflow, /autoenhanceEnabled \? \(/);
  assert.match(settings, /ProviderEnablementToggle/);
  assert.match(settings, /provider="autohdr"/);
  assert.match(settings, /provider="autoenhance"/);
});

test("disabled Autoenhance fails before credential or provider access", () => {
  const workflowGate = autoenhanceWorkflow.indexOf(
    'requirePhotoEditingProviderEnabled("autoenhance", admin.organizationId)',
  );
  const firstProviderMutation = autoenhanceWorkflow.indexOf("createOrder(orderName");
  assert.ok(workflowGate >= 0 && workflowGate < firstProviderMutation);

  const clientGate = autoenhanceClient.indexOf(
    'requirePhotoEditingProviderEnabled("autoenhance", organizationId)',
  );
  const keyRead = autoenhanceClient.indexOf('getCredential(\n    "autoenhance"');
  assert.ok(clientGate >= 0 && clientGate < keyRead);

  const webhookGate = webhook.indexOf(
    'isPhotoEditingProviderEnabled("autoenhance", organizationId)',
  );
  const webhookSecretRead = webhook.indexOf('getCredential(\n    "autoenhance"');
  assert.ok(webhookGate >= 0 && webhookGate < webhookSecretRead);
});

test("scheduled Autoenhance work skips disabled tenants", () => {
  const loop = autoenhanceWorkflow.indexOf("for (const batch of pending ?? [])");
  const enabledCheck = autoenhanceWorkflow.indexOf(
    'isPhotoEditingProviderEnabled("autoenhance", batch.organization_id)',
    loop,
  );
  const refresh = autoenhanceWorkflow.indexOf(
    "refreshBookingAutoenhanceBatch({",
    enabledCheck,
  );
  assert.ok(loop >= 0 && enabledCheck > loop && refresh > enabledCheck);
});

test("enablement read failures propagate instead of falling back to On", async () => {
  let environmentReads = 0;
  await assert.rejects(
    resolveCredentialStrict({
      field: "enabled",
      organizationId: "default-organization",
      defaultOrganizationId: "default-organization",
      loadProvider: async () => {
        throw new Error("database unavailable");
      },
      environmentValue: () => {
        environmentReads += 1;
        return "true";
      },
    }),
    /database unavailable/,
  );
  assert.equal(environmentReads, 0);
  await assert.rejects(
    resolveProviderEnabled({
      provider: "autoenhance",
      organizationId: "organization-a",
      envVar: "AUTOENHANCE_ENABLED",
      getCredential: async () => {
        throw new Error("database unavailable");
      },
    }),
    /database unavailable/,
  );
});

test("disabling and re-enabling preserves provider credentials", () => {
  const saved = {
    api_key: "secret-key",
    webhook_secret: "secret-hook",
    enabled: "true",
  };
  const disabled = mergeCredentialFields(saved, { enabled: "false" });
  assert.deepEqual(disabled, {
    api_key: "secret-key",
    webhook_secret: "secret-hook",
    enabled: "false",
  });
  assert.deepEqual(mergeCredentialFields(disabled, { enabled: "true" }), saved);
});

test("authoritative enablement reads observe Off after a previous On", async () => {
  let authoritative = { enabled: "true" };
  const read = () => resolveCredentialStrict({
    field: "enabled",
    organizationId: "organization-a",
    defaultOrganizationId: "default-organization",
    loadProvider: async () => authoritative,
    environmentValue: () => undefined,
  });
  assert.equal(await read(), "true");
  authoritative = { enabled: "false" };
  assert.equal(await read(), "false");
});
