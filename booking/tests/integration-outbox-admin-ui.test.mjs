import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../app/admin/integrations/jobs/page.tsx", import.meta.url),
  "utf8",
);
const actionsSource = readFileSync(
  new URL("../app/admin/integrations/jobs/actions.ts", import.meta.url),
  "utf8",
);
const navigationSource = readFileSync(
  new URL("../app/admin/AdminBottomNav.tsx", import.meta.url),
  "utf8",
);
const bookingActionsSource = readFileSync(
  new URL("../app/admin/bookings/[id]/actions.ts", import.meta.url),
  "utf8",
);

test("operator page is tenant-scoped, exception-only, and selects safe columns", () => {
  assert.match(pageSource, /await requireAdmin\(\)/);
  assert.match(pageSource, /\.from\("integration_jobs"\)/);
  assert.match(pageSource, /\.eq\("organization_id", admin\.organizationId\)/);
  assert.match(pageSource, /\.is\("reconciled_at", null\)/);
  for (const status of ["pending", "processing", "retryable", "dead_letter"]) {
    assert.match(pageSource, new RegExp(status));
  }
  assert.match(
    pageSource,
    /\.select\(\s*"id, booking_id, job_type, status, attempts, max_attempts, next_attempt_at, lease_expires_at, last_error_code, last_error_at, created_at, updated_at"/,
  );
  for (const unsafeColumn of [
    "payload",
    "provider_result",
    "provider_external_id",
    "idempotency_key",
    "locked_by",
    "lease_token",
    "last_error_message",
  ]) {
    assert.doesNotMatch(pageSource, new RegExp(unsafeColumn));
  }
});

test("process-now is limited to due pending or safely retryable email work", () => {
  const body = functionBody(actionsSource, "processIntegrationJobNow");
  assert.match(body, /await requireAdmin\(\)/);
  assert.match(body, /\.eq\("organization_id", admin\.organizationId\)/);
  assert.match(body, /email\.booking\.confirmation/);
  assert.match(body, /email\.admin\.new_booking/);
  assert.match(body, /row\.status === "pending"/);
  assert.match(body, /row\.status === "retryable"/);
  assert.match(body, /23 \* 60 \* 60 \* 1000/);
  assert.match(body, /jobTypes: \[row\.job_type\]/);
  assert.match(body, /buildIntegrationWorkerId\("admin-process-now"/);
  assert.doesNotMatch(body, /row\.status === "dead_letter"/);
});

test("mark-reconciled requires category and note and uses the authenticated RPC", () => {
  const body = functionBody(actionsSource, "markIntegrationJobReconciled");
  assert.match(body, /await requireAdmin\(\)/);
  assert.match(body, /category/);
  assert.match(body, /note\.length < 10/);
  assert.match(body, /await getServerSupabase\(\)/);
  assert.match(body, /\.rpc\("reconcile_integration_job"/);
  assert.match(body, /p_organization_id: admin\.organizationId/);
  assert.match(pageSource, /name="category"[\s\S]*required/);
  assert.match(pageSource, /name="note"[\s\S]*minLength=\{10\}[\s\S]*required/);
  assert.doesNotMatch(actionsSource, /status:\s*"pending"/);
});

test("exception page is not added to primary navigation", () => {
  assert.doesNotMatch(navigationSource, /\/admin\/integrations\/jobs/);
});

test("every QuickBooks create path blocks unresolved ambiguous outbox work", () => {
  const manualBody = functionBody(bookingActionsSource, "createInvoice");
  const sharedBody = functionBody(bookingActionsSource, "createInvoiceForBookingId");
  assert.match(manualBody, /createInvoiceForBookingId\(/);
  assert.match(sharedBody, /hasUnresolvedAmbiguousQuickBooksJob\(/);
  assert.match(bookingActionsSource, /job_type", "quickbooks\.invoice\.create"/);
  assert.match(bookingActionsSource, /\.eq\("status", "dead_letter"\)/);
  assert.match(bookingActionsSource, /\.is\("reconciled_at", null\)/);
  assert.match(bookingActionsSource, /ambiguous_provider_result/);
  assert.match(bookingActionsSource, /lease_expired_ambiguous/);
  assert.match(bookingActionsSource, /unsafe_retryable_status/);
});

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}
