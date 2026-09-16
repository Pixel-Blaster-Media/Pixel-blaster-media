import test from 'node:test';import assert from 'node:assert/strict';
import {makeChunkIndex} from '../lib/media/finals/chunk-index.ts';
const uid=n=>`${n}1111111-1111-4111-8111-111111111111`;
const identity={actorId:uid(2),operator:false,scope:{organizationId:uid(1),bookingId:uid(3),propertyId:uid(4)}};
const ix=makeChunkIndex({organization_id:uid(1),package_id:uid(5),release_id:uid(6),manifest_sha256:'b'.repeat(64)},{bytes:5,sha256:'c'.repeat(64),digests:'d'.repeat(64)});
test('only verified indexed current packages are advertised, flag-off makes no RPC',async()=>{
 const m=await import('../lib/media/finals/resume-availability.ts').catch(()=>({}));assert.equal(typeof m.resumeAvailability,'function');let calls=0,value=ix;
 const runtime={env:{},db:{rpc:async()=>{calls++;return {data:value,error:null}}}};
 const state={complete:true,packages:[{id:uid(5),release_id:uid(6),package_sha256:'\\x'+'c'.repeat(64),byte_size:5}]};
 assert.equal(await m.resumeAvailability(runtime,identity,state),null);assert.equal(calls,0);
 runtime.env.PHOTO_FINALS_RESUMABLE_ENABLED='1';assert.deepEqual((await m.resumeAvailability(runtime,identity,state)).packageIds,[uid(5)]);
 value=null;assert.deepEqual((await m.resumeAvailability(runtime,identity,state)).packageIds,[]);
 value={...ix,package_id:uid(9)};await assert.rejects(()=>m.resumeAvailability(runtime,identity,state));
});
