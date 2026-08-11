import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260811225000_canonical_media_releases.sql",
  import.meta.url,
);
const runnerUrl = new URL(
  "../scripts/verify-canonical-media-postgres.sh",
  import.meta.url,
);
const behaviorUrl = new URL(
  "../tests/postgres/canonical-media-schema.behavior.sql",
  import.meta.url,
);
const typeContractUrl = new URL(
  "../tests/types/canonical-media-types.test-d.ts",
  import.meta.url,
);
const migration = existsSync(migrationUrl)
  ? readFileSync(migrationUrl, "utf8")
  : "";
const setup = readFileSync(
  new URL("../supabase/setup.sql", import.meta.url),
  "utf8",
);
const databaseTypes = readFileSync(
  new URL("../lib/supabase/database.types.ts", import.meta.url),
  "utf8",
);
const runner = existsSync(runnerUrl) ? readFileSync(runnerUrl, "utf8") : "";
const behavior = existsSync(behaviorUrl)
  ? readFileSync(behaviorUrl, "utf8")
  : "";

const TABLES = [
  "media_batches",
  "media_assets",
  "media_versions",
  "media_derivatives",
  "provider_events",
  "media_ingest_jobs",
  "media_job_attempts",
  "gallery_releases",
  "gallery_release_items",
  "media_packages",
  "download_grants",
  "download_events",
  "listing_gallery_items",
];

test("canonical media migration defines the complete additive control plane", () => {
  assert.equal(existsSync(migrationUrl), true, "missing canonical media migration");
  for (const table of TABLES) {
    assert.match(migration, new RegExp(`create table public\\.${table}\\b`, "i"));
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      `${table} must enable RLS`,
    );
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} force row level security`, "i"),
      `${table} must force RLS`,
    );
    assert.match(databaseTypes, new RegExp(`\\b${table}:`));
  }
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete\s+from)\b/i);
  assert.match(migration, /organization_id uuid not null/g);
  assert.match(migration, /references public\.organizations\s*\(id\) on delete restrict/gi);
});

test("tenant-qualified identity and release constraints fail closed", () => {
  assert.match(migration, /unique \(organization_id, id\)/i);
  assert.match(
    migration,
    /foreign key \(organization_id, property_id\)[\s\S]*references public\.properties \(organization_id, id\)/i,
  );
  assert.match(
    migration,
    /foreign key \(organization_id, booking_id, property_id\)[\s\S]*references public\.bookings \(organization_id, id, property_id\)/i,
  );
  assert.match(
    migration,
    /foreign key \(\s*organization_id, media_version_id, property_id, batch_id\s*\)/i,
  );
  assert.match(migration, /unique[\s\S]*provider_connection_key[\s\S]*provider_job_id[\s\S]*provider_output_id[\s\S]*provider_revision/i);
  assert.match(migration, /unique[\s\S]*source_version_id[\s\S]*profile_id[\s\S]*profile_version/i);
  assert.match(migration, /unique[\s\S]*release_id[\s\S]*package_type[\s\S]*manifest_sha256/i);
});

test("accepted bytes, release snapshots, grants, and audit rows are immutable", () => {
  assert.match(migration, /object_key[\s\S]*sha256/i);
  assert.match(migration, /accepted_at/i);
  assert.match(migration, /prevent_media_storage_identity_mutation/i);
  assert.match(migration, /prevent_approved_release_mutation/i);
  assert.match(migration, /prevent_media_row_delete/i);
  assert.match(migration, /prevent_media_append_only_mutation/i);
  assert.match(migration, /token_key_id/i);
  assert.match(migration, /token_hash/i);
  assert.doesNotMatch(migration, /\bplaintext_token\b|\btoken_plaintext\b/i);
  assert.match(migration, /check \(pg_catalog\.octet_length\(token_hash\) = 32\)/i);
  assert.match(migration, /enforce_listing_gallery_item_approval/i);
  assert.match(migration, /for update/i);
  assert.match(
    migration,
    /foreign key \(\s*organization_id, release_id, property_id, batch_id, manifest_sha256\s*\)/i,
  );
  assert.equal(existsSync(typeContractUrl), true, "missing compile-time media type contract");
});

test("canonical media behavior is executable in disposable PostgreSQL", () => {
  assert.equal(existsSync(runnerUrl), true, "missing canonical media PostgreSQL runner");
  assert.equal(existsSync(behaviorUrl), true, "missing canonical media PostgreSQL behavior suite");
  assert.match(runner, /20260811225000_canonical_media_releases\.sql/);
  assert.match(runner, /canonical-media-schema\.behavior\.sql/);
  assert.match(runner, /Concurrent pending release item bypassed approval serialization/);
  assert.match(runner, /Concurrent listing insert bypassed release withdrawal serialization/);
  assert.match(runner, /Concurrent download grant bypassed release withdrawal serialization/);
  for (const proof of [
    "cross-tenant property reference should fail",
    "accepted object identity update should fail",
    "duplicate provider output should fail",
    "cross-release media version should fail",
    "unapproved listing item should fail",
    "download token hash update should fail",
    "append-only event update should fail",
    "canonical media delete should fail",
    "tenant RLS leaked another organization",
    "incomplete accepted media version should fail",
    "incomplete ready derivative should fail",
    "incomplete ready package should fail",
    "approved release item substitution should fail",
    "mismatched release package manifest should fail",
    "active listing release withdrawal should fail",
    "approved release provenance update should fail",
    "accepted version provenance update should fail",
    "download grant identity update should fail",
    "grant before ready release should fail",
    "active download grant release withdrawal should fail",
  ]) {
    assert.match(behavior, new RegExp(proof, "i"));
  }
});

test("fresh setup contains the canonical media migration exactly once", () => {
  const marker = "Begin supabase/migrations/20260811225000_canonical_media_releases.sql";
  assert.equal(setup.split(marker).length - 1, 1);
});
