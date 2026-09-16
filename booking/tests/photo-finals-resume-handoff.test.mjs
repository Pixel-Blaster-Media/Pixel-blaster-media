import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createResumeHandler} from '../lib/media/finals/resume-http.ts';import {makeChunkIndex} from '../lib/media/finals/chunk-index.ts';
const uid=n=>`${n}1111111-1111-4111-8111-111111111111`, bytes=Buffer.from('hello'),sha=createHash('sha256').update(bytes).digest('hex');
const identity={actorId:uid(2),sessionHash:'a'.repeat(64),operator:true,scope:{organizationId:uid(1),bookingId:uid(3),propertyId:uid(4)}};
const ix=makeChunkIndex({organization_id:uid(1),package_id:uid(5),release_id:uid(6),manifest_sha256:'b'.repeat(64)},{bytes:5,sha256:sha,digests:sha});
function setup(){let authority=true,settled=true,gets=0;const calls=[];
 const deps={env:{PHOTO_FINALS_RESUMABLE_ENABLED:'1',PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'synthetic-local',NODE_ENV:'test',PHOTO_FINALS_SYNTHETIC_ACK:'isolated-no-network',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([identity.scope])},authorize:async()=>authority?identity:null,runtime:async()=>({db:{rpc:async(n,a)=>{calls.push([n,a]);return {data:n.endsWith('begin')?{attempt:{id:uid(8)},index:ix,package:{id:uid(5),release_id:uid(6),object_key:`packages/${uid(1)}/${uid(6)}/full_res_zip/${sha}.zip`,package_sha256:'\\x'+sha,byte_size:5,bucket_name:'local'},offset:0,length:5,chunkSha256:sha}:settled,error:null};}},storage:{location:()=>({bucket:'local'}),getVerifiedPackageChunk:async()=>{gets++;return bytes;}}})};
 return {deps,h:createResumeHandler(deps),calls,get gets(){return gets},deny:()=>{authority=false},unsettle:()=>{settled=false}};
}
const request=signal=>new Request(`http://localhost/resume?transferId=${uid(7)}&index=0`,{signal});
test('no byte handed off before fresh auth and successful settlement; withdrawal withholds entire chunk',async()=>{
 for(const fail of ['auth','sql']){const f=setup(),r=await f.h(request(),uid(3));assert.equal(r.status,206);assert.equal(f.gets,1);assert.equal(f.calls.length,1);if(fail==='auth')f.deny();else f.unsettle();await assert.rejects(()=>r.arrayBuffer());assert.equal(f.calls.at(-1)[1].p_completed,false);}
});
test('aborted downstream cancels before settlement and emits no bytes',async()=>{const f=setup(),c=new AbortController(),r=await f.h(request(c.signal),uid(3));c.abort();await assert.rejects(()=>r.arrayBuffer());await new Promise(r=>setImmediate(r));assert.equal(f.calls.at(-1)[1].p_completed,false);});
test('one GET per attempt, conservative emitted observation, verified response headers',async()=>{const f=setup(),r=await f.h(request(),uid(3));assert.equal(r.headers.get('content-range'),'bytes 0-4/5');assert.equal(r.headers.get('x-chunk-sha256'),sha);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);assert.equal(f.gets,1);assert.equal(f.calls.at(-1)[1].p_completed,true);assert.equal(f.calls.at(-1)[1].p_emitted_bytes,0);});
