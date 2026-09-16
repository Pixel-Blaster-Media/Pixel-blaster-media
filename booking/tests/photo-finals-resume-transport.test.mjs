import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedFinalsFetch} from '../lib/media/finals/transport.ts';
test('index discovery and publication targets traverse the real bounded RPC allowlist',async()=>{
 const origin='https://dddddddddddddddddddd.supabase.co';let calls=0;
 const transport=boundedFinalsFetch(origin,async()=>{calls++;return Response.json(null);});
 for(const name of ['resume_index','package_index_targets'])assert.equal((await transport(origin+'/rest/v1/rpc/photo_finals_'+name,{method:'POST',body:'{}'})).status,200);
 assert.equal(calls,2);
});

test('indexed atomic publication transports both maximum compact vectors without increasing legacy request caps',async()=>{
 const origin='https://dddddddddddddddddddd.supabase.co';
 let calls=0;
 const transport=boundedFinalsFetch(origin,async(_url,init)=>{calls++;assert.ok(Buffer.byteLength(init.body)>262144);return new Response(null,{status:204});});
 const count=Math.ceil(1_100_000_000/131072);
 const body=JSON.stringify({p_org:'11111111-1111-4111-8111-111111111111',p_job:'11111111-1111-4111-8111-111111111112',p_lease:'11111111-1111-4111-8111-111111111113',p_evidence:[],p_indexes:[{digests:'\\x'+'ab'.repeat(count*32)},{digests:'\\x'+'cd'.repeat(count*32)}]});
 const response=await transport(origin+'/rest/v1/rpc/photo_finals_package_finish_indexed',{method:'POST',body});
 assert.equal(response.status,204);assert.equal(calls,1);
 await assert.rejects(transport(origin+'/rest/v1/rpc/photo_finals_package_finish',{method:'POST',body}));assert.equal(calls,1,'legacy request ceiling unchanged');
 await assert.rejects(transport(origin+'/rest/v1/rpc/photo_finals_package_finish_indexed',{method:'POST',body:'x'.repeat(2_097_153)}));assert.equal(calls,1,'finite new request ceiling before dispatch');
});
