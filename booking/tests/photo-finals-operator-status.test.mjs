import test from 'node:test';
import assert from 'node:assert/strict';
import {scope,identity,fixture} from './helpers/photo-finals-operator-fixture.mjs';
import {createFinalsHandler} from '../lib/media/finals/http.ts';
test('packaging GET exposes authorized terminal status without job credentials',async()=>{
 const f=fixture();f.runtime.readPackageStatus=async()=>({status:'needs_attention',lease:'SECRET'});
 const r=await createFinalsHandler(f.deps)(new Request('http://localhost/api/photo-finals/'+scope.bookingId),scope.bookingId);
 const body=await r.json();assert.deepEqual(body.packageJob,{status:'needs_attention'});assert.ok(!JSON.stringify(body).includes('SECRET'));assert.equal(f.callbacks.length,0);
});
test('job status classifies terminal, expired lease and exhausted attempts fail closed',async()=>{
 const {packageJobStatus}=await import('../lib/media/finals/operator-status.ts');
 const now=Date.now(),base={state:'discovered',attempts:0,max_attempts:3,completed_at:null,finals_lease_expires_at:null};
 assert.deepEqual(packageJobStatus(base,now),{status:'pending'});
 assert.deepEqual(packageJobStatus({...base,state:'retryable',attempts:1},now),{status:'retryable'});
 assert.deepEqual(packageJobStatus({...base,state:'deriving',attempts:3,finals_lease_expires_at:new Date(now+1000).toISOString()},now),{status:'running'});
 for(const row of [null,{...base,state:'dead_letter'},{...base,state:'deriving',attempts:3,finals_lease_expires_at:new Date(now-1).toISOString()},{...base,completed_at:new Date().toISOString()},{...base,state:'unknown'}])assert.deepEqual(packageJobStatus(row,now),{status:'needs_attention'});
 assert.deepEqual(packageJobStatus({...base,state:'deriving',attempts:1,finals_lease_expires_at:new Date(now-1).toISOString()},now),{status:'retryable'});
});

test('production status reader binds exact scope and rechecks revocation after the read',async()=>{
 const {createPackageStatusReader}=await import('../lib/media/finals/operator-status.ts');
 const {releaseId}=await import('./helpers/photo-finals-operator-fixture.mjs');
 let calls=0,requests=0,revoked=false;
 const db={async rpc(name,args){assert.equal(name,'photo_finals_access');assert.equal(args.p_operator,true);assert.equal(args.p_org,scope.organizationId);calls++;return {data:null,error:revoked?{}:null};}};
 const config={supabaseUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:'fixture-only'};
 const reader=createPackageStatusReader(config,identity,db,async(input,init)=>{
  requests++;const url=new URL(input);assert.equal(url.origin,config.supabaseUrl);assert.equal(url.pathname,'/rest/v1/media_ingest_jobs');
  for(const [key,value] of Object.entries({organization_id:'eq.'+scope.organizationId,property_id:'eq.'+scope.propertyId,finals_release_id:'eq.'+releaseId,'media_batches.booking_id':'eq.'+scope.bookingId,limit:'2',job_kind:'eq.package'}))assert.equal(url.searchParams.get(key),value);
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');revoked=true;
  return Response.json([{state:'discovered',attempts:0,max_attempts:3,completed_at:null,finals_lease_expires_at:null}]);
 });
 await assert.rejects(reader(releaseId));assert.equal(requests,1);assert.equal(calls,2);
 await assert.rejects(reader(releaseId));assert.equal(requests,1,'revoked operator must not read service table');
});

test('finish between current and status reads does not strand a poll in attention',async()=>{
 const f=fixture();let finished=false;const rpc=f.runtime.db.rpc;
 f.runtime.db.rpc=async(...args)=>{const result=await rpc(...args);if(args[0]==='photo_finals_current'&&finished)result.data.release.state='ready';return result;};
 f.runtime.readPackageStatus=async()=>{finished=true;return {status:'needs_attention'};};
 const r=await createFinalsHandler(f.deps)(new Request('http://localhost/api/photo-finals/'+scope.bookingId),scope.bookingId);
 const body=await r.json();assert.equal(body.release.state,'ready');assert.equal(body.packageJob,null);
});
