import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const repairName = "20260813023000_autohdr_database_hardening.sql";
const repairUrl = new URL(`supabase/migrations/${repairName}`, root);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("the additive AutoHDR repair makes claim creation explicit and revokes direct DML", () => {
  assert.equal(existsSync(repairUrl), true, "missing additive AutoHDR hardening migration");
  const migration = readFileSync(repairUrl, "utf8");
  assert.match(migration, /claim_autohdr_job[\s\S]*returns table[\s\S]*newly_created boolean/i);
  assert.match(migration, /on conflict on constraint autohdr_jobs_idempotency_key do nothing[\s\S]*returning \*/i);
  assert.match(migration, /revoke insert, update, delete on table public\.autohdr_jobs from service_role/i);
  assert.match(migration, /revoke insert, update, delete on table public\.autohdr_job_files from service_role/i);
  assert.match(migration, /revoke select on table public\.autohdr_jobs from authenticated/i);
  assert.match(migration, /create (?:or replace )?function public\.list_autohdr_jobs/i);
  assert.doesNotMatch(
    migration.match(/list_autohdr_jobs[\s\S]*?returns table \([\s\S]*?\)\s*language (?:sql|plpgsql)/i)?.[0] ?? "",
    /retrieval_claim_token/i,
  );
});

test("setup, generated types, and adapter require the database boolean without inference", () => {
  const setup = read("supabase/setup.sql");
  const types = read("lib/supabase/database.types.ts");
  const adapter = read("lib/integrations/autohdr/database-adapter.ts");
  assert.equal(setup.split(`Begin supabase/migrations/${repairName}`).length - 1, 1);
  assert.match(types, /type AutoHDRClaimRow = AutoHDRJobsTable\["Row"\] & \{[\s\S]*newly_created: boolean;/);
  assert.match(types, /claim_autohdr_job:[\s\S]*Returns: AutoHDRClaimRow\[\]/);
  assert.match(types, /list_autohdr_jobs:/);
  assert.match(adapter, /typeof row\.newly_created !== "boolean"/);
  assert.match(adapter, /newlyCreated: row\.newly_created/);
  assert.doesNotMatch(adapter, /newlyCreated:\s*(?:row\.)?(?:state|created_at|createdAt)|newlyCreated:\s*!/);
});
