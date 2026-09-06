import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',code)((name)=> { if (name in dependencies) return dependencies[name]; throw Error(name); },exports);
  return exports;
}
const org='11111111-1111-4111-8111-111111111111', booking='22222222-2222-4222-8222-222222222222', job='33333333-3333-4333-8333-333333333333';
function route({claim=true,authorized=true,settles=true,quiet=false}={}) {
  const calls=[];
  const snapshot={scheduled_at:'2026-09-07T14:00:00Z',street_address:'Fixture Street',city:'Toronto',email:'fixture@example.com',contact_name:'Fixture',company_name:'Fixture Co',from_name:'Fixture Co',reply_to:null,suppress_realtor_notifications:quiet};
  const db={rpc: async(name,args)=> { calls.push([name,args]); return {error:null,data:name==='list_due_booking_reminders'?[{organization_id:org,booking_id:booking,schedule_version:1}]:name==='claim_booking_reminder'?(claim?{id:job,organization_id:org,booking_id:booking,schedule_version:1,lease_token:args.p_lease_token,payload:snapshot,attempts:1,idempotency_key:'reminder:'+job}:null):name==='authorize_booking_reminder'?authorized:settles}; },from:()=> { const q=new Proxy({}, {get:(_,key)=>key==='then'?undefined:()=>key==='returns'?Promise.resolve({data:[{id:booking,organization_id:org,scheduled_at:snapshot.scheduled_at,properties:{street_address:'Fixture Street',city:'Toronto'},profiles:{email:snapshot.email},suppress_realtor_notifications:quiet}],error:null}):q}); return q; }};
  const mod=load('app/api/cron/reminders/route.ts',{
    'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200})}},
    'node:crypto':{randomUUID:()=> '44444444-4444-4444-8444-444444444444',createHash:()=>({update(){return this;},digest:()=> 'a'.repeat(64)})},
    '@/lib/booking/availability':{BUSINESS_TZ:'America/Toronto',businessDateTimeLocalToUtc:(s)=>new Date(s+'Z')},
    '@/lib/booking/manage-token':{createManageToken:()=> 'signed'},
    '@/lib/email/resend':{sendEmail:async args=> {calls.push(['send',args]);return {ok:true,id:'provider-1'};}},
    '@/lib/email/settings':{getOrganizationEmailSettings:async()=>({organizationName:'Fixture Co'})},
    '@/lib/email/templates':{shootReminderEmail:()=>({subject:'Reminder',html:'content'})},
    '@/lib/notifications/push':{sendPushBestEffort:async()=>calls.push(['push'])},
    '@/lib/supabase/server':{getServiceSupabase:()=>db},
  });
  return {calls,run:()=>mod.GET(new Request('https://fixture.test/api/cron/reminders',{headers:{authorization:'Bearer fixture'}}))};
}
process.env.CRON_SECRET='fixture';process.env.NEXT_PUBLIC_APP_URL='https://fixture.test';
test('reminder never calls provider without a database lease',async()=>{const r=route({claim:false});await r.run();assert.equal(r.calls.filter(c=>c[0]==='send').length,0);});
test('reminder binds request bytes before sending and checks settlement',async()=>{const r=route();const result=await r.run();assert.deepEqual(r.calls.map(c=>c[0]),['list_due_booking_reminders','claim_booking_reminder','push','authorize_booking_reminder','send','finish_booking_reminder']);assert.equal(r.calls.find(c=>c[0]==='send')[1].idempotencyKey,'reminder:'+job);assert.equal(result.body.sent,1);});
test('changed request hash never sends',async()=>{const r=route({authorized:false});await r.run();assert.equal(r.calls.filter(c=>c[0]==='send').length,0);});
test('lost settlement is counted as failure, not confirmed sent',async()=>{const r=route({settles:false});const result=await r.run();assert.equal(result.body.sent,0);assert.equal(result.body.failed,1);});
test('quiet reminder keeps one internal push and skips realtor email',async()=>{const r=route({quiet:true});await r.run();assert.equal(r.calls.filter(c=>c[0]==='push').length,1);assert.equal(r.calls.filter(c=>c[0]==='send').length,0);assert.equal(r.calls.find(c=>c[0]==='finish_booking_reminder')[1].p_outcome,'skipped');});
export {load};
