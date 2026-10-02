import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const prior = read('supabase/migrations/20260718202432_atomic_public_booking_outbox.sql');
const candidate = read('supabase/migrations/20260930185645_public_booking_property_identity.sql');
function body(source) {
  const start = source.indexOf('create or replace function public.create_public_booking_with_jobs');
  const end = source.indexOf('\n$$;', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 4).replace('create_public_booking_with_jobs_catalog_v1(', 'create_public_booking_with_jobs(');
}
test('property identity migration leaves replay, pricing, duration, shared lock and creation jobs byte-identical', () => {
  const additions = `    and pg_catalog.lower(pg_catalog.btrim(coalesce(property.city, ''))) =
        pg_catalog.lower(pg_catalog.btrim(coalesce(p_city, '')))
    and pg_catalog.upper(pg_catalog.regexp_replace(coalesce(property.postal_code, ''), '\\s', '', 'g')) =
        pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_postal_code, ''), '\\s', '', 'g'))
`;
  assert.equal(candidate.split(additions).length, 2);
  assert.equal(body(candidate).replace(additions, ''), body(prior));
});
test('identity regression fixture is part of the final-schema disposable database gate', () => {
  assert.match(read('scripts/verify-clean-bootstrap-postgres.sh'), /tests\/postgres\/booking-audit.behavior.sql/);
  const fixture = read('tests/postgres/booking-audit.behavior.sql');
  assert.match(fixture, /public.create_public_booking_with_jobs\(/);
  assert.match(fixture, /Different tenant reused property/);
  assert.match(fixture, /Historical property or booking changed/);
  assert.match(fixture, /Failed enqueue did not roll back booking and notices/);
  assert.match(fixture, /rollback;/);
});
