import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrationName = "20260813030000_autohdr_provider_recovery.sql";
const migrationUrl = new URL(`supabase/migrations/${migrationName}`, root);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("provider recovery is an additive migration with atomic activation and bounded evidence", () => {
  assert.equal(existsSync(migrationUrl), true, "missing additive provider recovery migration");
  const migration = readFileSync(migrationUrl, "utf8");

  assert.match(migration, /create (?:or replace )?function public\.activate_autohdr_provider_job/i);
  assert.match(migration, /set[\s\S]*provider_uid[\s\S]*state\s*=\s*'awaiting_upload'/i);
  assert.match(migration, /state\s*<>\s*'preparing'|state\s*=\s*'preparing'[\s\S]*provider_uid\s+is\s+null/i);
  assert.match(migration, /create (?:or replace )?function public\.reconcile_autohdr_provider_job/i);
  assert.match(migration, /p_error_evidence[\s\S]*char_length[\s\S]*(?:500|512)/i);
  assert.match(migration, /create (?:or replace )?function public\.abandon_autohdr_provider_job/i);
  assert.match(migration, /abandoned_by[\s\S]*abandon_reason[\s\S]*abandoned_at/i);
  assert.match(migration, /revoke all on function public\.activate_autohdr_provider_job[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.activate_autohdr_provider_job[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /signed[_ ]?url|upload_url|presigned/i);
});

test("setup, types, and application contract expose recovery RPCs without capabilities", () => {
  const setup = read("supabase/setup.sql");
  const types = read("lib/supabase/database.types.ts");
  const contract = read("lib/integrations/autohdr/database-contract.ts");

  assert.equal(setup.split(`Begin supabase/migrations/${migrationName}`).length - 1, 1);
  assert.match(types, /upload_started_at: string \| null/);
  assert.match(types, /finalize_started_at: string \| null/);
  assert.match(types, /reconciliation_required_at: string \| null/);
  assert.match(types, /last_error_evidence: string \| null/);
  assert.match(types, /abandoned_by: string \| null/);
  assert.match(types, /activate_autohdr_provider_job:/);
  assert.match(types, /reconcile_autohdr_provider_job:/);
  assert.match(types, /abandon_autohdr_provider_job:/);
  assert.match(contract, /activateProviderJob:\s*["']activate_autohdr_provider_job["']/);
  assert.match(contract, /reconcileProviderJob:\s*["']reconcile_autohdr_provider_job["']/);
  assert.match(contract, /abandonProviderJob:\s*["']abandon_autohdr_provider_job["']/);
  assert.doesNotMatch(JSON.stringify({ types, contract }), /signed[_ ]?url|upload_url|presigned/i);
});
