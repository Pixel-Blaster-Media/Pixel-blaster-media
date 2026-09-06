import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../app/admin/calendar/actions.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('actions.ts',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createAdminShoot');
const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(result){
 const calls=[];
 const query={select(){return this},eq(){return this},async maybeSingle(){return {data:{full_name:'Realtor',phone:'',brokerage:''}}}};
 const context={exports:{},process:{env:{}},console,crypto:globalThis.crypto,
  requireAdmin:async()=>({organizationId:'tenant',userId:'actor'}),
  str:(f,k)=>String(f.get(k)??'').trim(),businessDateTimeLocalToUtc:()=>new Date('2030-01-01T15:00Z'),parseOptionalInt:()=>3000,
  getActiveCatalog:async()=>({bundles:[],aLaCarte:[],addons:[]}),findOrCreateRealtor:async()=>({userId:'owner',newlyCreated:false}),
  getServiceSupabase:()=>({from:()=>query,rpc:async(name,input)=>{calls.push({name,input});return result}}),
  dispatchBookingIntegrationJobs:async()=>{throw Error('replay must not dispatch')},syncRealtorCalendarEventsBestEffort:async()=>{throw Error('replay must not fan out')}
 };
 vm.runInNewContext(code,context);return {action:context.exports.createAdminShoot,calls};
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
function form(){const f=new FormData();for(const [k,v] of Object.entries({admin_request_id:'00000000-0000-4000-8000-000000000001',scheduled_at:'2030-01-01T10:00',contact_email:'r@example.test',contact_name:'Realtor',street_address:'Test',catalog_item_id:'catalog'}))f.set(k,v);return f;}
test('actual create action passes stable request identity and replay has no effects',async()=>{
 const h=harness({data:{booking_id:'booking',replayed:true}});const f=form();
 for(let i=0;i<2;i++)assert.equal((await h.action(f)).bookingId,'booking');
 assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0],h.calls[1]);
 assert.equal(h.calls[0].input.p_request_id,f.get('admin_request_id'));assert.equal(h.calls[0].input.p_expected_version,null);
});
test('actual create action rejects missing request identity before RPC',async()=>{const h=harness({});const f=form();f.delete('admin_request_id');assert.equal((await h.action(f)).ok,false);assert.equal(h.calls.length,0)});
