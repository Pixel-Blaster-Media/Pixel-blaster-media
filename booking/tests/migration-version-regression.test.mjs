import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const setupPath = new URL("../supabase/setup.sql", import.meta.url);
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

test("Supabase migration versions are unique", () => {
  const filesByVersion = new Map();
  for (const file of migrationFiles) {
    const version = file.split("_", 1)[0];
    filesByVersion.set(version, [...(filesByVersion.get(version) ?? []), file]);
  }

  const duplicates = [...filesByVersion.entries()].filter(
    ([, files]) => files.length > 1,
  );
  assert.deepEqual(
    duplicates,
    [],
    `Duplicate migration versions: ${duplicates
      .map(([version, files]) => `${version} (${files.join(", ")})`)
      .join("; ")}`,
  );
});

test("catalog merchandising repair is timestamped and idempotent", async () => {
  const file = migrationFiles.find((name) =>
    name.endsWith("_catalog_merchandising_columns.sql"),
  );
  assert.ok(file, "Missing catalog merchandising repair migration");
  assert.match(file, /^\d{14}_catalog_merchandising_columns\.sql$/);

  const sql = await readFile(new URL(file, migrationsDirectory), "utf8");
  assert.match(sql, /add column if not exists badge text/i);
  assert.match(sql, /add column if not exists highlight boolean/i);
  assert.match(sql, /add column if not exists ideal_for text/i);
  assert.match(sql, /notify pgrst,\s*'reload schema'/i);
  assert.match(sql, /set lock_timeout = '5s'/i);

  const updateBlocks = [...sql.matchAll(
    /update public\.catalog_items\s+set[\s\S]*?where slug = '([^']+)'[\s\S]*?;/gi,
  )];
  assert.deepEqual(
    updateBlocks.map((match) => match[1]),
    ["blue_print", "social_media_special", "social_media_plus", "ultimate"],
    "Only Pixel Blaster's four intended packages may receive defaults",
  );

  for (const match of updateBlocks) {
    assert.match(
      match[0],
      /and organization_id = '00000000-0000-0000-0000-000000000001'/i,
      `Missing Pixel Blaster organization scope for ${match[1]}`,
    );
    assert.match(match[0], /and badge is null/i);
    assert.match(match[0], /and ideal_for is null/i);
    assert.match(
      match[0],
      /and highlight = false/i,
      `Missing highlight preservation guard for ${match[1]}`,
    );
  }
});

test("generated Supabase setup includes the repaired migration", async () => {
  const setupSql = await readFile(setupPath, "utf8");
  assert.match(
    setupSql,
    /Begin supabase\/migrations\/20260716141227_catalog_merchandising_columns\.sql/,
  );
  assert.doesNotMatch(
    setupSql,
    /0012_spiro_inspired_catalog_merchandising\.sql/,
  );
  assert.match(
    setupSql,
    /Begin supabase\/migrations\/20260717140806_quarantine_unprovisioned_auth_users\.sql/,
  );
  assert.doesNotMatch(setupSql, /create the first company account at \/start/i);
});
