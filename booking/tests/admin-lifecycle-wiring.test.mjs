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
test('managed and calendar moves affected-row-check version and status',()=>{
 for(const p of ['app/book/manage/[token]/actions.ts','app/admin/calendar/actions.ts']) {
  const s=read(p); assert.match(s,/\.eq\("lifecycle_version", booking.lifecycle_version\)/); assert.match(s,/\.eq\("status", booking.status\)/); assert.match(s,/data: updatedBooking/);
 }
});
