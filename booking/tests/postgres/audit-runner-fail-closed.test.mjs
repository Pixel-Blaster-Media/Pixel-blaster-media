import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('lifecycle SQL gate rejects a missing required recovery migration', () => {
  const temp = mkdtempSync(join(tmpdir(), 'audit-gate-missing-'));
  const root = resolve(import.meta.dirname, '../..');
  try {
    mkdirSync(join(temp, 'scripts'));
    cpSync(join(root, 'scripts/verify-admin-lifecycle-postgres.py'), join(temp, 'scripts/verify-admin-lifecycle-postgres.py'));
    cpSync(join(root, 'tests/postgres'), join(temp, 'tests/postgres'), { recursive: true });
    cpSync(join(root, 'supabase/migrations'), join(temp, 'supabase/migrations'), { recursive: true });
    rmSync(join(temp, 'supabase/migrations/20260905100500_booking_effect_generations.sql'));
    const result = spawnSync('python3', [join(temp, 'scripts/verify-admin-lifecycle-postgres.py')], { encoding: 'utf8', timeout: 90000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0, 'gate silently passed without exercising aggregate/effect integration');
    assert.match(result.stderr, /required recovery migration missing/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
