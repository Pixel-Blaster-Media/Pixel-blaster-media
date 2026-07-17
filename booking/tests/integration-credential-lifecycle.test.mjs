import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildQuickBooksOAuthState,
  quickBooksOAuthStateMatchesAdmin,
} from "../lib/integrations/quickbooks/oauth-state.ts";

const integrationActionsSource = await readFile(
  new URL("../app/admin/settings/integrations/actions.ts", import.meta.url),
  "utf8",
);
const quickBooksCallbackSource = await readFile(
  new URL(
    "../app/api/integrations/quickbooks/callback/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const googleClientSource = await readFile(
  new URL("../lib/integrations/google-calendar/client.ts", import.meta.url),
  "utf8",
);

function functionBody(source, exportedName) {
  const start = source.indexOf(`export async function ${exportedName}`);
  assert.notEqual(start, -1, `${exportedName} must exist`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("QuickBooks OAuth state is bound to its initiating admin and organization", () => {
  const state = buildQuickBooksOAuthState("user-a", "organization-a");
  assert.match(state, /^[a-f0-9]{48}\.[a-f0-9]{32}$/);
  assert.equal(
    quickBooksOAuthStateMatchesAdmin(state, "user-a", "organization-a"),
    true,
  );
  assert.equal(
    quickBooksOAuthStateMatchesAdmin(state, "user-b", "organization-a"),
    false,
  );
  assert.equal(
    quickBooksOAuthStateMatchesAdmin(state, "user-a", "organization-b"),
    false,
  );
  assert.equal(
    quickBooksOAuthStateMatchesAdmin("malformed", "user-a", "organization-a"),
    false,
  );
});

test("QuickBooks kickoff builds state from the authenticated tenant context", () => {
  const kickoff = functionBody(integrationActionsSource, "startQuickBooksConnect");
  assert.match(kickoff, /const admin = await requireAdmin\(\)/);
  assert.match(
    kickoff,
    /buildQuickBooksOAuthState\(\s*admin\.userId,\s*admin\.organizationId,?\s*\)/,
  );
  assert.doesNotMatch(kickoff, /randomBytes\(/);
});

test("QuickBooks callback burns state and rejects a changed admin or organization", () => {
  assert.match(
    quickBooksCallbackSource,
    /quickBooksOAuthStateMatchesAdmin\([\s\S]*state,[\s\S]*admin\.userId,[\s\S]*admin\.organizationId/,
  );
  const cookieDelete = quickBooksCallbackSource.indexOf(
    "cookieStore.delete(STATE_COOKIE)",
  );
  const contextCheck = quickBooksCallbackSource.indexOf(
    "quickBooksOAuthStateMatchesAdmin(",
  );
  const errorHandling = quickBooksCallbackSource.indexOf("if (errorParam)");
  const tokenExchange = quickBooksCallbackSource.indexOf(
    "exchangeCodeForTokens({",
  );
  assert.ok(cookieDelete >= 0 && cookieDelete < contextCheck);
  assert.ok(contextCheck < errorHandling);
  assert.ok(errorHandling < tokenExchange);
  assert.match(quickBooksCallbackSource, /qbo_error", "state_context_mismatch"/);
});

test("Google disconnect removes every tenant-owned calendar token row", () => {
  const deletion = functionBody(
    googleClientSource,
    "deleteGoogleCalendarConnection",
  );
  assert.match(deletion, /scope: CalendarConnectionScope/);
  assert.match(deletion, /\.delete\(\)[\s\S]*\.eq\("organization_id", orgId\)/);
  assert.doesNotMatch(deletion, /\.eq\("id", conn\.id\)/);
  assert.doesNotMatch(deletion, /if \(!conn\) return null/);
  assert.match(deletion, /if \(deleted\.error\)[\s\S]*throw new Error/);
});
