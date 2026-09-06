import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('PostgreSQL required check executes full fresh bootstrap and detects stale generated SQL', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const postgres = ci.slice(ci.indexOf('  postgresql:'));
  assert.match(postgres, /name: PostgreSQL integration/);
  assert.match(postgres, /bash scripts\/generate-supabase-setup\.sh/);
  assert.match(postgres, /git diff --exit-code -- supabase\/setup\.sql/);
  assert.match(postgres, /node --test tests\/postgres\/clean-bootstrap\.test\.mjs/);
});
