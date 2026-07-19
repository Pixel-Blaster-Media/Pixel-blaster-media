import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

test("production migration history uses canonical timestamp versions", () => {
  const noncanonical = migrationFiles.filter(
    (name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name),
  );

  assert.deepEqual(
    noncanonical,
    [],
    `Move pre-ledger bootstrap migrations out of supabase/migrations: ${noncanonical.join(", ")}`,
  );
});

const productionLedger = JSON.parse(
  await readFile(
    new URL("../supabase/production-migration-ledger.json", import.meta.url),
    "utf8",
  ),
);
const reconciledRemoteBaselineVersions = productionLedger.migrations.map(
  (migration) => migration.version,
);

test("production ledger evidence has complete body fingerprints", () => {
  assert.equal(productionLedger.project_ref, "szwbvpbljsycozihkmyq");
  assert.equal(
    productionLedger.hash_definition,
    "md5(array_to_string(statements, E'\\n'))",
  );
  assert.equal(productionLedger.migrations.length, 28);
  for (const migration of productionLedger.migrations) {
    assert.match(migration.version, /^\d{14}$/);
    assert.match(migration.name, /^[a-z0-9_]+$/);
    assert.ok(Number.isInteger(migration.statement_count));
    assert.ok(migration.statement_count > 0);
    assert.match(migration.body_md5, /^[a-f0-9]{32}$/);
  }
});

test("canonical migrations contain the reconciled production baseline", () => {
  const versions = migrationFiles.map((name) => name.split("_", 1)[0]);
  const latestAppliedVersion = reconciledRemoteBaselineVersions.at(-1);
  assert.ok(latestAppliedVersion);

  const missing = reconciledRemoteBaselineVersions.filter(
    (version) => !versions.includes(version),
  );
  const staleAliases = versions.filter(
    (version) =>
      version <= latestAppliedVersion &&
      !reconciledRemoteBaselineVersions.includes(version),
  );

  assert.deepEqual(missing, [], `Missing applied remote versions: ${missing.join(", ")}`);
  assert.deepEqual(
    staleAliases,
    [],
    `Archive local aliases that are absent from production: ${staleAliases.join(", ")}`,
  );
});

test("fresh-project setup uses bootstrap history and the canonical cutover", async () => {
  const setupSql = await readFile(
    new URL("../supabase/setup.sql", import.meta.url),
    "utf8",
  );

  assert.match(setupSql, /Begin supabase\/bootstrap-migrations\/0001_init\.sql/);
  assert.match(
    setupSql,
    /Begin supabase\/bootstrap-migrations\/20260710153500_harden_push_subscription_grants\.sql/,
  );
  assert.doesNotMatch(
    setupSql,
    /Begin supabase\/migrations\/20260710160525_harden_push_subscription_grants\.sql/,
  );
  assert.match(
    setupSql,
    /Begin supabase\/migrations\/20260716141227_catalog_merchandising_columns\.sql/,
  );
});

test("completed auth rollout cannot be mistaken for a current production runbook", async () => {
  const rollout = await readFile(
    new URL("../docs/auth-rollout.md", import.meta.url),
    "utf8",
  );

  assert.match(rollout, /Historical rollout record — completed/);
  assert.match(
    rollout,
    /Do not execute the historical apply or migration-repair steps against production/i,
  );
  assert.match(
    rollout,
    /already contains[^\n]+20260717140806[^\n]+20260717211142/i,
  );
});

test("completed outbox rollout cannot instruct production reapplication", async () => {
  const rollout = await readFile(
    new URL("../docs/INTEGRATION_OUTBOX.md", import.meta.url),
    "utf8",
  );

  assert.match(rollout, /Rollout status — completed/);
  assert.match(
    rollout,
    /Do not reapply migration `20260718202432` or repair its production ledger entry/i,
  );
});
