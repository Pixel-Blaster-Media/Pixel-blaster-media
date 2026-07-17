import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../lib/integrations/credentials.ts", import.meta.url),
  "utf8",
);
const fotelloClientSource = readFileSync(
  new URL("../lib/integrations/fotello/client.ts", import.meta.url),
  "utf8",
);
const fotelloSyncSource = readFileSync(
  new URL("../lib/integrations/fotello/sync.ts", import.meta.url),
  "utf8",
);
const emailSource = readFileSync(
  new URL("../lib/email/resend.ts", import.meta.url),
  "utf8",
);
const autoenhanceSource = readFileSync(
  new URL("../lib/integrations/autoenhance/client.ts", import.meta.url),
  "utf8",
);
const iguideSource = readFileSync(
  new URL("../lib/integrations/iguide/portal-client.ts", import.meta.url),
  "utf8",
);
const deliverableMigrationUrl = new URL(
  "../supabase/migrations/20260716210000_tenant_scope_deliverable_external_ids.sql",
  import.meta.url,
);
const deliverableMigration = existsSync(deliverableMigrationUrl)
  ? readFileSync(deliverableMigrationUrl, "utf8")
  : "";
const iguideSyncSource = readFileSync(
  new URL("../lib/integrations/iguide/sync.ts", import.meta.url),
  "utf8",
);
const bookingActionsSource = readFileSync(
  new URL("../app/admin/bookings/[id]/actions.ts", import.meta.url),
  "utf8",
);

test("deployment environment credentials are available only to the default organization", () => {
  assert.match(
    source,
    /organizationId\s*===\s*DEFAULT_ORGANIZATION_ID\s*\?\s*process\.env\[envVar\]/,
  );
  assert.doesNotMatch(source, /const fromEnv = process\.env\[envVar\]\?\.trim\(\);/);
});

test("credential source badges cannot report platform environment credentials to another tenant", () => {
  const guardedReads = source.match(
    /organizationId\s*===\s*DEFAULT_ORGANIZATION_ID\s*\?\s*process\.env\[envVar\]/g,
  );
  assert.equal(guardedReads?.length, 2);
});

test("credential APIs never choose an organization implicitly", () => {
  assert.doesNotMatch(source, /organizationId\s*=\s*DEFAULT_ORGANIZATION_ID/);
  for (const functionName of [
    "getCredential",
    "getCredentialSource",
    "saveCredentials",
    "clearCredentialFields",
  ]) {
    assert.match(
      source,
      new RegExp(
        `(?:async )?function ${functionName}\\([\\s\\S]*?organizationId: string`,
      ),
    );
  }
});

test("Fotello API requests require organization scope", () => {
  assert.match(fotelloClientSource, /async function apiKey\(organizationId: string\)/);
  assert.match(
    fotelloClientSource,
    /getCredential\([\s\S]*?"fotello",[\s\S]*?"api_key",[\s\S]*?"FOTELLO_API_KEY",[\s\S]*?organizationId,[\s\S]*?\)/,
  );
  for (const functionName of [
    "getEnhance",
    "createListing",
    "createUpload",
    "createEnhance",
    "prepareDownload",
  ]) {
    assert.match(
      fotelloClientSource,
      new RegExp(`function ${functionName}\\([\\s\\S]*?organizationId: string`),
    );
  }
});

test("Fotello synchronization carries organization scope into provider requests", () => {
  assert.match(fotelloSyncSource, /TrackEnhanceArgs[\s\S]*organizationId: string/);
  assert.match(
    fotelloSyncSource,
    /getEnhance\(enhanceId, organizationId\)/,
  );
});

test("email sending requires a concrete organization", () => {
  assert.match(emailSource, /organizationId: string;/);
  assert.doesNotMatch(emailSource, /organizationId\?:|organizationId\s*\?\?\s*undefined/);
});

test("Autoenhance requests cannot omit organization scope", () => {
  assert.doesNotMatch(autoenhanceSource, /organizationId\?: string/);
  assert.match(autoenhanceSource, /async function apiKey\(organizationId: string\)/);
});

test("iGUIDE portal requests cannot omit organization scope", () => {
  assert.match(iguideSource, /interface PortalScope\s*{\s*organizationId: string;/);
  assert.doesNotMatch(iguideSource, /scope\?: PortalScope|scope\?\.organizationId/);
});

test("deliverable provider identities are unique within an organization", () => {
  assert.match(deliverableMigration, /add column if not exists organization_id uuid/i);
  assert.match(deliverableMigration, /new\.organization_id[\s\S]*booking_organization_id/i);
  assert.match(
    deliverableMigration,
    /b\.property_id\s+is distinct from\s+d\.property_id/i,
  );
  assert.match(
    deliverableMigration,
    /new\.property_id\s+is distinct from\s+booking_property_id/i,
  );
  assert.match(
    deliverableMigration,
    /if not exists[\s\S]*deliverables_organization_source_external_id_key[\s\S]*unique\s*\(organization_id,\s*source,\s*external_id\)/i,
  );
  assert.doesNotMatch(
    deliverableMigration,
    /unique\s*\(source,\s*external_id\)/i,
  );
  for (const runtimeSource of [
    fotelloSyncSource,
    iguideSyncSource,
    bookingActionsSource,
  ]) {
    assert.match(
      runtimeSource,
      /onConflict:\s*["']organization_id,source,external_id["']/,
    );
  }
});
