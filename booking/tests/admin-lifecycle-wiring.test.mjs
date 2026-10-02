import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('all admin aggregate entrypoints delegate to the atomic RPC',()=>{
 const create=read('app/admin/calendar/actions.ts');
 const edit=read('app/admin/bookings/[id]/actions.ts');
 assert.match(create,/save_admin_booking_aggregate/);
 assert.match(edit,/save_admin_booking_aggregate/);
 assert.doesNotMatch(create,/\.from\("booking_line_items"\)\s*\.insert/);
 assert.doesNotMatch(edit,/async function replaceBookingLineItems/);
});
test('managed and calendar moves compare version and recheck status at mutation',()=>{
 const calendar=read('app/admin/calendar/actions.ts');
 assert.match(calendar,/\.eq\("lifecycle_version", booking.lifecycle_version\)/);
 assert.match(calendar,/\.eq\("status", booking.status\)/);
 assert.match(calendar,/data: updatedBooking/);
 const managed=read('app/book/manage/[token]/actions.ts');
 assert.match(managed,/changeBookingWithNotices\(\{[\s\S]*expectedVersion: booking.lifecycle_version/);
 const sql=read('supabase/migrations/20260930185759_booking_lifecycle_notices.sql');
 assert.match(sql,/organization_id = p_organization_id for update/);
 assert.match(sql,/b.lifecycle_version <> p_expected_version/);
 assert.match(sql,/b.status not in \('requested', 'confirmed'\)/);
 // Existing deferred effect bookkeeping may increment the lifecycle version.
 // The runtime fixture flushes constraints and compares returned/stored versions.
 assert.ok(sql.indexOf('perform public.refresh_booking_effects') < sql.indexOf('for notice in select'));
 assert.match(read('tests/postgres/booking-audit.behavior.sql'),/set constraints all immediate;[\s\S]*Deferred effect refresh changed/);
});
