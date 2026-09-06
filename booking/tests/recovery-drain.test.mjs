import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as core from '../lib/integrations/scheduler-core.ts';
function scheduler(list) {
 const calls=[];let page=0;
 const dependencies={'server-only':{},'node:crypto':{randomUUID:()=> 'worker'},'./dispatcher':{dispatchBookingIntegrationJobs:async args=>{calls.push(args);return [{outcome:'completed'}];}},'./dispatcher-core':{buildIntegrationWorkerId:()=> 'worker'},'./jobs':{listDueIntegrationJobs:async()=>({outcome:'listed',jobs:list[page++]??[]})},'./scheduler-core':core};
 const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL('../lib/integrations/scheduler.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(name=>dependencies[name],exports);
 return {run:()=>exports.runScheduledIntegrationOutbox({dispatchNotBefore:'2026-09-01T00:00:00.000Z'}),calls};
}
const jobs=Array.from({length:5},(_,i)=>({organizationId:'org',bookingId:'b'+i,jobType:'email.admin.new_booking'}));
test('scheduled recovery drains successive pages but never dispatches unlisted types',async()=>{const r=scheduler([jobs,[{organizationId:'org',bookingId:'next',jobType:'email.booking.confirmation'}]]);const result=await r.run();assert.equal(result.listed,6);assert.equal(r.calls.length,6);assert.deepEqual(r.calls.at(-1).jobTypes,['email.booking.confirmation']);});
test('scheduled recovery is capped at three pages and does not spin on identical identities',async()=>{const r=scheduler([jobs,jobs,jobs,jobs]);const result=await r.run();assert.equal(r.calls.length,5);assert.equal(result.listed,5);});
test('reminder template uses an absolute date, not tomorrow during same-day retries',()=>{const exports={};const source=readFileSync(new URL('../lib/email/templates.ts',import.meta.url),'utf8');new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(()=>({}),exports);const result=exports.shootReminderEmail({contactName:'Fixture',streetAddress:'1 Fixture',timeLabel:'Sep 7, 10 a.m.',manageLink:'https://fixture.test/manage'});assert.doesNotMatch(result.html+result.subject,/tomorrow/i);assert.match(result.html,/Sep 7/);});
