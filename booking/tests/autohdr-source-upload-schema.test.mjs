import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationName = "20260813015534_autohdr_canonical_source_upload.sql";
const migration = readFileSync(
  new URL(`../supabase/migrations/${migrationName}`, import.meta.url),
  "utf8",
);
const quarantineMigrationName = "20260813025818_autohdr_quarantine_source_ingestion.sql";
const quarantineMigration = readFileSync(
  new URL(`../supabase/migrations/${quarantineMigrationName}`, import.meta.url),
  "utf8",
);
const setup = readFileSync(new URL("../supabase/setup.sql", import.meta.url), "utf8");
const databaseTypes = readFileSync(
  new URL("../lib/supabase/database.types.ts", import.meta.url),
  "utf8",
);

test("AutoHDR source upload stays canonical and service-role only", () => {
  assert.doesNotMatch(migration, /create table public\.(?:autohdr_)?source_(?:assets|versions)/i);
  assert.doesNotMatch(migration, /dimension_policy/i);
  assert.doesNotMatch(
    migration,
    /drop constraint(?: if exists)? media_versions_accepted_check/i,
  );
  assert.doesNotMatch(migration, /alter table public\.media_versions/i);
  assert.match(migration, /alter table public\.media_ingest_jobs/i);
  assert.match(migration, /'pixel-blaster-private-media'/);
  assert.match(
    migration,
    /masters\/['"]?\s*\|\|[\s\S]*v_asset_id[\s\S]*v_version_id[\s\S]*v_file\.sha256/i,
  );
  assert.doesNotMatch(migration, /\/sha256\//i);
  assert.match(migration, /security definer/gi);
  assert.match(
    migration,
    /revoke all on function public\.create_autohdr_source_batch[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    quarantineMigration,
    /revoke all on function public\.create_autohdr_source_batch[\s\S]*from service_role/i,
  );
  assert.match(
    quarantineMigration,
    /grant execute on function public\.prepare_autohdr_source_batch[\s\S]*to service_role/i,
  );
});

test("fresh setup and database types expose the canonical source RPC slice", () => {
  const marker = `Begin supabase/migrations/${migrationName}`;
  assert.equal(setup.split(marker).length - 1, 1);
  assert.equal(setup.split(`Begin supabase/migrations/${quarantineMigrationName}`).length - 1, 1);
  assert.match(databaseTypes, /create_autohdr_source_batch:/);
  assert.match(databaseTypes, /prepare_autohdr_source_batch:/);
  assert.match(databaseTypes, /autohdr_source_ingests:/);
  assert.match(databaseTypes, /accept_autohdr_source_version:/);
  assert.doesNotMatch(databaseTypes, /dimension_policy/);
  assert.match(databaseTypes, /newly_created: boolean/);
  assert.match(databaseTypes, /p_verified_width_px: number/);
  assert.match(databaseTypes, /p_verified_height_px: number/);
  assert.match(databaseTypes, /source_version_id: string \| null/);
});
