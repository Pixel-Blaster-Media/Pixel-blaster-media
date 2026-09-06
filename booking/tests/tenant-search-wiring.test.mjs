import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
test('public renderer gates tenant parents before media reads', () => {
 const source=read('../app/listings/[slug]/page.tsx');
 assert.ok(source.indexOf('!validListingRelations(website, property, bookingResult.data)') < source.indexOf('.from("deliverables")'));
 assert.match(source, /!website\.is_published/);
 assert.equal(source.match(/\.eq\("organization_id", website\.organization_id\)/g)?.length,3);
});
test('admin pages use scoped SQL search and visible cursor windows, not capped samples', () => {
 for (const [page,rpc] of [['bookings','admin_booking_search'],['realtors','admin_realtor_search']]) {
  const source=read(`../app/admin/${page}/page.tsx`);
  assert.match(source,new RegExp(`supabase.rpc\\("${rpc}"`));
  assert.match(source,/p_organization_id: admin.organizationId/);
  assert.match(source,/p_query:/);
  assert.match(source,/p_after:/);
  assert.match(source,/slice\(0, 50\)/);
  assert.match(source,/Next page/);
  assert.doesNotMatch(source,/\.limit\((300|500|1000)\)/);
 }
});
test('executable disposable proof and generated migration markers remain available', () => {
 const setup=read('../supabase/setup.sql');
 for(const name of ['20260905100300_listing_integrity_admin_search.sql','20260905100400_admin_search.sql']) assert.ok(setup.includes(name));
 assert.match(read('../package.json'),/test:postgres:tenant-search/);
 assert.match(read('./postgres/tenant-search-thresholds.sql'),/generate_series\(1,1200\)/);
});
