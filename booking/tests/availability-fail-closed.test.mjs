import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(failure, googleFailure = false) {
  const exports = {};
  const db = { from(table) {
    const result = { data: table === 'business_hours' ? Array.from({length:7}, (_, day_of_week) => ({day_of_week, start_time:'09:00:00',end_time:'17:00:00',enabled:true})) : [], error: table === failure ? {message:'unavailable'} : null };
    const query = new Proxy({}, {get(_, key) { return key === 'then' ? (resolve) => resolve(result) : () => query; }});
    return query;
  }};
  const source = fs.readFileSync(new URL('../lib/booking/availability.ts',import.meta.url),'utf8');
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports, console, Date, Intl, require(name) {
    if(name==='server-only') return {};
    if(name.includes('google-calendar/client')) return {getGoogleCalendarClients: async () => {if(googleFailure) throw Error('offline');return [];}};
    if(name.includes('supabase/server')) return {getServiceSupabase:()=>db};
    if(name.includes('organizations/default')) return {DEFAULT_ORGANIZATION_ID:'org'};
    if(name==='./services') return {totalDurationMinutes:()=>60};
    throw Error(name);
  }});
  return exports;
}
const args={from:new Date('2030-01-01T14:00:00Z'),to:new Date('2030-01-01T22:00:00Z'),durationMinutes:60};
test('unconfigured optional calendar permits ordinary slots',async()=>assert.ok((await load().listAvailableSlots(args)).length>0));
for(const source of ['business_hours','calendar_blocks','bookings']) test(`required ${source} failure cannot offer slots`,async()=>{
  await assert.rejects(load(source).listAvailableSlots(args),/availability/i);
});
test('connected calendar failure cannot offer slots',async()=>await assert.rejects(load(null,true).listAvailableSlots(args),/availability/i));
test('configured busy calendar with missing OAuth configuration fails closed',async()=>{
 const source=fs.readFileSync(new URL('../lib/integrations/google-calendar/client.ts',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('export async function getGoogleCalendarClients('),source.indexOf('async function clientFromConnection('));
 const code=ts.transpileModule(section,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};
 vm.runInNewContext(code,{exports,process:{env:{}},getGoogleCalendarConnections:async()=>[{id:1}],Error});
 await assert.rejects(exports.getGoogleCalendarClients({blockAvailability:true}),/configuration/i);
});
