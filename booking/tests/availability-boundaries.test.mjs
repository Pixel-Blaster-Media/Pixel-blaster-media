import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(bookings = [], failSecondPage = false) {
  const db = { from(table) {
    let data = table === 'business_hours'
      ? Array.from({length:7}, (_, day_of_week) => ({day_of_week, start_time:'09:00:00',end_time:'17:00:00',enabled:true}))
      : table === 'bookings' ? bookings : [];
    let rangeStart = 0, rangeEnd = Infinity;
    const query = new Proxy({}, {get(_, key) {
      if (key === 'then') return resolve => resolve(failSecondPage && rangeStart > 0 ? {data:null,error:{code:'offline'}} : {data:data.slice(rangeStart, rangeEnd + 1), error:null});
      return (...args) => {
        if (table === 'bookings') {
          if (key === 'range') [rangeStart, rangeEnd] = args;
          if (key === 'gte') data = data.filter(row => row[args[0]] >= args[1]);
          if (key === 'lt') data = data.filter(row => row[args[0]] < args[1]);
          if (key === 'neq') data = data.filter(row => row[args[0]] !== args[1]);
          if (key === 'or') {
            const from = args[0].match(/^scheduled_ends_at\.gt\.([^,]+),scheduled_ends_at\.is\.null$/)?.[1];
            assert.ok(from, 'mock only permits the interval-overlap predicate');
            data = data.filter(row => row.scheduled_ends_at === null || row.scheduled_ends_at > from);
          }
        }
        return query;
      };
    }});
    return query;
  }};
  const exports = {};
  const source = fs.readFileSync(new URL('../lib/booking/availability.ts',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports, Date, Intl, console, require(name) {
      if(name==='server-only') return {};
      if(name.includes('google-calendar/client')) return {getGoogleCalendarClients:async()=>[]};
      if(name.includes('supabase/server')) return {getServiceSupabase:()=>db};
      if(name.includes('organizations/default')) return {DEFAULT_ORGANIZATION_ID:'org'};
      if(name==='./services') return {totalDurationMinutes:services=>services.includes('long')?600:60};
      if(name==='@/lib/booking/timezone') return {BUSINESS_TZ:'America/Toronto'};
      throw Error(name);
    },
  });
  return exports;
}

for (const [name,from,to,first,last] of [
  ['fall back','2026-10-31T04:00:00Z','2026-11-03T05:00:00Z','2026-10-31T13:00:00.000Z','2026-11-02T21:00:00.000Z'],
  ['spring forward','2026-03-07T05:00:00Z','2026-03-10T04:00:00Z','2026-03-07T14:00:00.000Z','2026-03-09T20:00:00.000Z'],
  ['year boundary','2026-12-31T05:00:00Z','2027-01-03T05:00:00Z','2026-12-31T14:00:00.000Z','2027-01-02T21:00:00.000Z'],
]) test(`one unique set of local business-day slots across ${name}`,async()=>{
  const slots=await load().listAvailableSlots({from:new Date(from),to:new Date(to),durationMinutes:60});
  const starts=Array.from(slots,x=>x.start);
  assert.equal(starts.length,45);
  assert.equal(new Set(starts).size,45);
  assert.deepEqual([...starts].sort(),starts);
  assert.equal(starts[0],first);assert.equal(starts.at(-1),last);
});

const range={from:new Date('2030-01-07T14:00:00Z'),to:new Date('2030-01-07T17:00:00Z'),durationMinutes:60};
const long={id:'existing',scheduled_at:'2030-01-07T05:00:00.000Z',scheduled_ends_at:'2030-01-07T15:00:00.000Z',services:['long'],add_ons:[],status:'confirmed'};
for(const end of [long.scheduled_ends_at,null]) test(`long booking blocks the start of the query window with ${end?'stored':'legacy inferred'} end`,async()=>{
  const slots=await load([{...long,scheduled_ends_at:end}]).listAvailableSlots(range);
  assert.equal(slots.some(x=>x.start<'2030-01-07T15:00:00.000Z'),false);
  assert.equal(slots[0].start,'2030-01-07T15:00:00.000Z');
});
test('an interval ending exactly at the query start does not block it',async()=>{
  const slots=await load([{...long,scheduled_ends_at:range.from.toISOString()}]).listAvailableSlots(range);
  assert.equal(slots[0].start,range.from.toISOString());
});
test('rescheduling still excludes the booking itself',async()=>{
  const slots=await load([long]).listAvailableSlots({...range,excludeBookingId:'existing'});
  assert.equal(slots[0].start,range.from.toISOString());
});

const olderLegacy = Array.from({length:501},(_,index)=>({...long,id:`older-${index}`,scheduled_at:'2000-01-01T05:00:00.000Z',scheduled_ends_at:null}));
test('overlap after a full result page is still excluded',async()=>{
 const slots=await load([...olderLegacy,long]).listAvailableSlots(range);
 assert.equal(slots[0].start,'2030-01-07T15:00:00.000Z');
});
test('failure on a later interval page fails closed',async()=>{
 await assert.rejects(load([...olderLegacy,long],true).listAvailableSlots(range),/Availability/);
});
