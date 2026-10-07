import assert from 'node:assert/strict';
import test from 'node:test';
import {loadSource} from './helpers/source-module.mjs';
const policy=loadSource('lib/booking/catalog-upload-policy.ts');
const core=loadSource('lib/booking/catalog-examples-core.ts',{'./catalog-upload-policy.ts':policy});
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',catalog='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const claim='cccccccc-cccc-4ccc-8ccc-cccccccccccc',example='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function fixture({state='attached',status='resume',foreign=false,providerError=false,expired=false}={}){
 const calls=[];let providerCalls=0;let inspectionCalls=0;
 const row={id:claim,organization_id:foreign?'other-tenant':org,catalog_item_id:catalog,
  upload_protocol:'tus',state,stream_uid:'a'.repeat(32),example_id:example,
  upload_url:'https://upload.videodelivery.net/mock-capability',upload_size:500_000_000,
  upload_fingerprint:'e'.repeat(64),upload_expires_at:new Date(Date.now()+(expired?-3600_000:3600_000)).toISOString()};
 const db={rpc:async(name,args)=>{calls.push({name,args});
  if(name==='claim_catalog_resumable_upload')return {data:{status,claim_id:claim,expires_at:new Date(Date.now()+3600_000).toISOString()},error:null};
  if(name==='attach_catalog_stream_upload'){row.state='attached';return {data:null,error:null};}throw new Error('Unmocked RPC');},
  from(table){assert.equal(table,'catalog_stream_upload_claims');const filters=[];let update;
   const query={update(data){update=data;return query},eq(k,v){filters.push([k,v]);return query},select(){return query},
    async maybeSingle(){calls.push({filters,update});if(!filters.every(([k,v])=>row[k]===v))return {data:null,error:null};
     if(update)Object.assign(row,update);return {data:row,error:null};},
    then(resolve){calls.push({filters,update});if(filters.every(([k,v])=>row[k]===v)&&update)Object.assign(row,update);resolve({data:null,error:null});}};return query;}};
 const route=loadSource('app/api/admin/catalog-examples/upload/route.ts',{
  'next/server':{NextResponse:Response},'@/lib/auth/require-admin':{requireAdmin:async()=>({organizationId:org})},
  '@/lib/supabase/server':{getServiceSupabase:()=>db},'@/lib/booking/catalog-upload-policy':policy,
  '@/lib/booking/catalog-examples-core':{...core,inspectStreamTusReservation:async()=>{inspectionCalls++;return {verified:false,stage:'restriction_verification',httpStatus:200,checks:{claimMetadata:false}}},createStreamTusUpload:async()=>{providerCalls++;if(providerError)throw new core.StreamProvisioningError('mock provider ambiguous','ambiguous','a'.repeat(32));return {uid:'a'.repeat(32),uploadUrl:row.upload_url};}},
 });
 const post=(extra={})=>route.POST(new Request('https://booking.example.invalid/api/admin/catalog-examples/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({protocol:'tus',size:500_000_000,fingerprint:'e'.repeat(64),catalogItemId:catalog,title:'Sample video',description:'',idempotencyKey:claim,...extra})}));
 const get=(id=claim)=>route.GET(new Request('https://booking.example.invalid/api/admin/catalog-examples/upload?claimId='+id));
 return {post,get,row,calls,get providerCalls(){return providerCalls},get inspectionCalls(){return inspectionCalls}};
}
test('actual route resumes only the authorized service claim without allocating another provider upload',async()=>{
 const a=fixture();const r=await a.post();assert.equal(r.status,200);const body=await r.json();assert.equal(body.exampleId,example);assert.equal(body.resumed,true);assert.equal(a.providerCalls,0);
 assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 assert.equal(a.calls[0].args.p_organization_id,org);const filters=a.calls.find(c=>c.filters).filters;
 assert.deepEqual(filters,[['id',claim],['organization_id',org],['catalog_item_id',catalog],['upload_protocol','tus']]);
});
test('actual route rejects size/fingerprint before quota or provider allocation',async()=>{
 for(const extra of [{size:1_000_000_001},{size:0},{fingerprint:'bad'}]){const a=fixture();assert.equal((await a.post(extra)).status,400);assert.equal(a.calls.length,0);assert.equal(a.providerCalls,0)}
});
test('actual route withholds capabilities for foreign, expired and ambiguous pending claims',async()=>{
 for(const settings of [{foreign:true},{expired:true},{state:'provider_unknown'}]){const a=fixture(settings);const r=await a.post();assert.equal(r.status,409);assert.equal((await r.json()).uploadUrl,undefined);assert.equal(a.providerCalls,0)}
});
test('concurrent attachment is reread safely without deleting the successful provider video',async()=>{
 const a=fixture({state:'provisioned'});assert.equal((await a.post()).status,200);assert.equal(a.calls.filter(c=>c.name==='attach_catalog_stream_upload').length,1);assert.equal(a.calls.filter(c=>c.filters&&!c.update).length,2);assert.equal(a.providerCalls,0);
});
test('known provider UID survives restriction verification failure for durable cleanup',async()=>{
 const a=fixture({state:'claimed',status:'claimed',providerError:true});assert.equal((await a.post()).status,503);assert.equal(a.row.state,'cleanup_required');assert.equal(a.row.stream_uid,'a'.repeat(32));assert.equal(a.providerCalls,1);
});


test('diagnostic GET scopes existing claim to admin company and never reserves, updates, attaches or deletes',async()=>{
 const a=fixture({state:'cleanup_required'});const r=await a.get();assert.equal(r.status,200);
 const body=await r.json();assert.equal(body.state,'cleanup_required');assert.equal(body.inspection.checks.claimMetadata,false);
 assert.equal(a.providerCalls,0);assert.equal(a.inspectionCalls,1);
 assert.equal(a.calls.length,1);assert.equal(a.calls[0].update,undefined);
 assert.deepEqual(a.calls[0].filters,[['id',claim],['organization_id',org],['upload_protocol','tus']]);
 assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 assert.doesNotMatch(JSON.stringify(body),/mock-capability|stream_uid|upload_url|fingerprint/);
 for(const settings of [{foreign:true}]){const f=fixture(settings);assert.equal((await f.get()).status,404);assert.equal(f.inspectionCalls,0);assert.equal(f.providerCalls,0)}
 const invalid=fixture();assert.equal((await invalid.get('invalid')).status,400);assert.equal(invalid.calls.length,0);
 const noUid=fixture({state:'provider_unknown'});noUid.row.stream_uid=null;
 assert.equal((await noUid.get()).status,200);assert.equal(noUid.inspectionCalls,0);assert.equal(noUid.providerCalls,0);
});
