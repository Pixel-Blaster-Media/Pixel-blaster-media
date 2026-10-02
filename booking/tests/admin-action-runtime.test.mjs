import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {BOOKING_QUOTE_POLICY_VERSION, BOOKING_QUOTE_CHANGED_MESSAGE} from '../lib/booking/quote.ts';
const source=fs.readFileSync(new URL('../app/admin/calendar/actions.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('actions.ts',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createAdminShoot');
const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(result,{committedRequest=null,requestError=null}={}){
 const calls=[],lookups=[],realtors=[];
 const query=table=>({select(){return this},eq(key,value){lookups.push([table,key,value]);return this},async maybeSingle(){return table==='admin_booking_requests'?{data:committedRequest,error:requestError}:{data:{full_name:'Realtor',phone:'',brokerage:''}}}});
 const context={BOOKING_QUOTE_POLICY_VERSION,BOOKING_QUOTE_CHANGED_MESSAGE,exports:{},process:{env:{}},console,crypto:globalThis.crypto,
  requireAdmin:async()=>({organizationId:'tenant',userId:'actor'}),
  str:(f,k)=>String(f.get(k)??'').trim(),businessDateTimeLocalToUtc:()=>new Date('2030-01-01T15:00Z'),parseOptionalInt:()=>3000,
  getActiveCatalog:async()=>({bundles:[],aLaCarte:[],addons:[]}),findOrCreateRealtor:async args=>{realtors.push(args);return {userId:'owner',newlyCreated:false}},
  getServiceSupabase:()=>({from:table=>query(table),rpc:async(name,input)=>{calls.push({name,input});return result}}),
  dispatchBookingIntegrationJobs:async()=>{throw Error('replay must not dispatch')},syncRealtorCalendarEventsBestEffort:async()=>{throw Error('replay must not fan out')}
 };
 vm.runInNewContext(code,context);return {action:context.exports.createAdminShoot,calls,lookups,realtors};
}
test('actual package action forwards submitted CAS and stops on stale conflict', async()=>{
 const src=fs.readFileSync(new URL('../app/admin/bookings/[id]/actions.ts',import.meta.url),'utf8');
 const tree=ts.createSourceFile('details.ts',src,ts.ScriptTarget.Latest,true);
 const action=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='updateBookingServicesFromCalendar');
 const compiled=ts.transpileModule(action.getText(tree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const booking={id:'booking',owner_id:'owner',lifecycle_version:99,services:['bundle'],add_ons:[],properties:{street_address:'Test'},scheduled_at:'2030-01-01T15:00Z'};
 const calls=[];const query={select(){return this},eq(){return this},async single(){return {data:booking}}};
 const item={id:'catalog',slug:'bundle',kind:'bundle',active:true};
 const ctx={exports:{},crypto:globalThis.crypto,requireAdminForBooking:async()=>({organizationId:'tenant',userId:'actor'}),
 getServiceSupabase:()=>({from:()=>query,rpc:async(name,input)=>{calls.push(input);return {error:{code:'PB004'}}}}),
 getFullCatalog:async()=>({}),catalogRows:()=>[item],validateCart:()=>null,computeCartTotals:()=>({totalDurationMinutes:90}),str:(f,k)=>String(f.get(k)??'').trim(),
 syncGoogleCalendarEventBestEffort:()=>{throw Error('stale action must not sync')}};
 vm.runInNewContext(compiled,ctx);const f=form();f.set('lifecycle_version','7');
 assert.equal((await ctx.exports.updateBookingServicesFromCalendar('booking',f)).ok,false);
 assert.equal(calls.length,1);assert.equal(calls[0].p_expected_version,7);assert.equal(calls[0].p_request_id,f.get('admin_request_id'));
});
function form(){const f=new FormData();for(const [k,v] of Object.entries({quote_policy_version:BOOKING_QUOTE_POLICY_VERSION,admin_request_id:'00000000-0000-4000-8000-000000000001',scheduled_at:'2030-01-01T10:00',contact_email:'r@example.test',contact_name:'Realtor',street_address:'Test',catalog_item_id:'catalog'}))f.set(k,v);return f;}
test('actual create action passes stable request identity and replay has no effects',async()=>{
 const h=harness({data:{booking_id:'booking',replayed:true}});const f=form();
 for(let i=0;i<2;i++)assert.equal((await h.action(f)).bookingId,'booking');
 assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0],h.calls[1]);
 assert.equal(h.calls[0].input.p_request_id,f.get('admin_request_id'));assert.equal(h.calls[0].input.p_expected_version,null);
});
test('actual create action rejects missing request identity before RPC',async()=>{const h=harness({});const f=form();f.delete('admin_request_id');assert.equal((await h.action(f)).ok,false);assert.equal(h.calls.length,0)});

test('actual admin create action requires the browser quote version before provisioning or RPC',async()=>{
 for(const version of [null,'','legacy']) {
  const h=harness({});const f=form();if(version===null)f.delete('quote_policy_version');else f.set('quote_policy_version',version);
  const result=await h.action(f);assert.equal(result.ok,false);assert.equal(result.error,BOOKING_QUOTE_CHANGED_MESSAGE);assert.equal(h.calls.length,0);assert.equal(h.realtors.length,0);
 }
});

for (const version of [null, '', 'legacy', BOOKING_QUOTE_POLICY_VERSION]) test(`historical admin create replay bypasses only new-quote gate: ${version}`, async () => {
 const h=harness({data:{booking_id:'historical',replayed:true}},{committedRequest:{actor_id:'actor'}});
 const f=form();if(version===null)f.delete('quote_policy_version');else f.set('quote_policy_version',version);
 assert.equal((await h.action(f)).bookingId,'historical');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].input.p_input.quote_policy_version,version??'');
 assert.equal(h.realtors[0].allowCreate,false);
 assert.ok(h.lookups.some(([table,key,value])=>table==='admin_booking_requests'&&key==='organization_id'&&value==='tenant'));
});
for (const options of [{committedRequest:{actor_id:'other-admin'}},{requestError:{code:'unavailable'}}]) test('admin replay lookup fails closed before provisioning or RPC',async()=>{
 const h=harness({},options);assert.equal((await h.action(form())).ok,false);assert.equal(h.calls.length,0);assert.equal(h.realtors.length,0);
});

test('the actual realtor helper cannot provision a missing account during replay',async()=>{
 const helper=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='findOrCreateRealtor');
 const compiled=ts.transpileModule(helper.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const query={select(){return this},ilike(){return this},async maybeSingle(){return {data:null,error:null}}};
 const ctx={exports:{},getServiceSupabase:()=>({from:()=>query}),provisionRealtorAuthUser:async()=>{throw Error('Replay must not provision')}};
 vm.runInNewContext(compiled+'\nexports.helper=findOrCreateRealtor;',ctx);
 assert.equal(await ctx.exports.helper({organizationId:'tenant',email:'new@example.invalid',fullName:'New',allowCreate:false}),null);
});
