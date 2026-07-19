import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260719124500_integration_outbox_recovery_reconciliation.sql",
  import.meta.url,
);

test("recovery migration is additive and exposes identities-only fair due work", () => {
  assert.equal(existsSync(migrationUrl), true, "missing recovery migration");
  const sql = readFileSync(migrationUrl, "utf8");

  assert.match(sql, /add column if not exists reconciled_at timestamptz/i);
  assert.match(sql, /add column if not exists reconciled_by uuid/i);
  assert.doesNotMatch(
    sql,
    /reconciled_by uuid references public\.profiles\(id\) on delete set null/i,
    "deleting a profile must not invalidate or erase a completed audit actor",
  );
  assert.match(sql, /add column if not exists reconciliation_category text/i);
  assert.match(sql, /add column if not exists reconciliation_note text/i);
  assert.match(sql, /create or replace function public\.list_due_integration_jobs/i);
  assert.match(sql, /p_limit integer[\s\S]*p_dispatch_not_before timestamptz/i);
  assert.match(sql, /returns table \([\s\S]*organization_id uuid[\s\S]*booking_id uuid[\s\S]*job_type text[\s\S]*\)/i);
  assert.doesNotMatch(sql, /returns table \([\s\S]*payload jsonb/i);
  assert.match(sql, /row_number\(\) over \(\s*partition by[\s\S]*organization_id/i);
  assert.match(sql, /quickbooks\.invoice\.create'[\s\S]*then 1/i);
  assert.match(sql, /email\.booking\.confirmation'[\s\S]*then 3/i);
  assert.match(sql, /status = 'processing'[\s\S]*lease_expires_at <= pg_catalog\.now\(\)/i);
  assert.match(sql, /booking\.status = 'cancelled'/i);
  assert.match(sql, /job_type not in \([\s\S]*email\.booking\.confirmation[\s\S]*email\.admin\.new_booking/i);
  assert.match(sql, /status = 'retryable'[\s\S]*status = 'dead_letter'/i);
  assert.match(sql, /created_at >= p_dispatch_not_before/i);
  assert.match(sql, /char_length\(p_worker_id\) > 96/i);
  assert.match(sql, /grant execute on function public\.list_due_integration_jobs[\s\S]*to service_role/i);
  assert.match(sql, /revoke all on function public\.list_due_integration_jobs[\s\S]*from public, anon, authenticated/i);
});

test("reconciliation RPC is tenant-admin authorized, audited, and single-use", () => {
  const sql = readFileSync(migrationUrl, "utf8");
  assert.match(sql, /create or replace function public\.reconcile_integration_job/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /organization_members[\s\S]*role in \('owner', 'admin'\)/i);
  assert.match(sql, /job\.status = 'dead_letter'/i);
  assert.match(sql, /job\.reconciled_at is null/i);
  assert.match(sql, /reconciliation_category = pg_catalog\.btrim\(p_category\)/i);
  assert.match(sql, /reconciliation_note = pg_catalog\.btrim\(p_note\)/i);
  assert.match(sql, /grant execute on function public\.reconcile_integration_job[\s\S]*to authenticated/i);
  assert.match(sql, /revoke all on function public\.reconcile_integration_job[\s\S]*from public, anon, service_role/i);
});

test("fresh setup and PostgreSQL behavior runner include the additive recovery migration", () => {
  const setup = readFileSync(new URL("../supabase/setup.sql", import.meta.url), "utf8");
  const runner = readFileSync(
    new URL("../scripts/verify-atomic-booking-postgres.sh", import.meta.url),
    "utf8",
  );
  assert.match(setup, /End supabase\/migrations\/20260719124500_integration_outbox_recovery_reconciliation\.sql/);
  assert.match(runner, /20260719124500_integration_outbox_recovery_reconciliation\.sql/);
});

test("PostgreSQL suite exercises fair recovery and one-time reconciliation", () => {
  const behavior = readFileSync(
    new URL("./postgres/atomic-booking-outbox.behavior.sql", import.meta.url),
    "utf8",
  );
  assert.match(behavior, /pre-rollout jobs crossed the configured watermark/);
  assert.match(behavior, /due integration list was not tenant fair/);
  assert.match(behavior, /invoice was not ordered before customer email/);
  assert.match(behavior, /due list did not preserve exact invoice-before-email scope/);
  assert.match(behavior, /expired processing email was not listed/);
  assert.match(behavior, /cancelled booking cleared an active provider lease/);
  assert.match(behavior, /expired final-attempt processing job was not recoverable/);
  assert.match(behavior, /cancelled expired lease was not preserved for reconciliation/);
  assert.match(behavior, /cancelled booking job was claimable/);
  assert.match(behavior, /non-email retryable work was not prohibited/);
  assert.match(behavior, /reconciliation audit was not persisted/);
  assert.match(behavior, /reconciliation was not single-use/);
  assert.match(behavior, /completed reconciliation audit was mutable/);
  assert.match(behavior, /cross-tenant reconciliation was authorized/);
});
