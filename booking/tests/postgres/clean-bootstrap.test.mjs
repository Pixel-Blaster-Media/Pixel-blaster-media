import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const [name, sql, error] of [
  ['invalid final migration', 'select missing_bootstrap_function();', /missing_bootstrap_function/],
  ['leaked service RPC grant', 'grant execute on all functions in schema public to anon;', /Incorrect runtime RPC grants/],
]) test(`full bootstrap rejects ${name}`, () => {
  const root = mkdtempSync(join(tmpdir(), 'bootstrap-negative-'));
  try {
    cpSync(new URL('../../supabase/', import.meta.url), join(root, 'supabase'), {recursive:true});
    mkdirSync(join(root, 'scripts'));
    for (const script of ['generate-supabase-setup.sh', 'verify-clean-bootstrap-postgres.sh']) cpSync(new URL(`../../scripts/${script}`, import.meta.url), join(root, 'scripts', script));
    cpSync(new URL('./', import.meta.url), join(root, 'tests/postgres'), {recursive:true});
    writeFileSync(join(root, 'supabase/migrations/20990101000000_bootstrap_negative.sql'), sql);
    const result = spawnSync('bash', ['scripts/verify-clean-bootstrap-postgres.sh'], {cwd:root,encoding:'utf8',timeout:120000});
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, error);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('full generated fresh setup executes on PostgreSQL 17 and passes tenant/grant behavior', () => {
  const result = spawnSync('bash', ['scripts/verify-clean-bootstrap-postgres.sh'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /CLEAN_BOOTSTRAP_BEHAVIOR_PASSED/);
});
