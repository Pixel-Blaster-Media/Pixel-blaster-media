import test from 'node:test';
import assert from 'node:assert/strict';
const path='../lib/media/finals/http.ts';
test('application RPC adapter refuses arbitrary RPC names',async()=>{
 const m=await import('../lib/media/finals/rpc-adapter.ts').catch(()=>null);assert.ok(m,'bounded application adapter required');
 let calls=0;const db=m.createFinalsApplicationDatabase({rpc(){calls++;return Promise.resolve({data:null,error:null});}});
 const rejected=await db.rpc('arbitrary_service_function',{});assert.ok(rejected.error);assert.equal(calls,0);
 const valid=await db.rpc('photo_finals_access',{});assert.equal(valid.error,null);assert.equal(calls,1);
});
test('JSON ingress rejects streamed overflow without waiting for cancellation',async()=>{
 const {boundedFinalsJson}=await import(path);
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(16385));},cancel(){return new Promise(()=>{});}});
 const request=new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'});
 await Promise.race([assert.rejects(boundedFinalsJson(request)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('cancellation stalled')),200))]);
});
test('HTTP boundary authenticates before bodies and fails closed without runtime',async()=>{
 const mod=await import(path).catch(()=>null);assert.ok(mod,'actual finals HTTP handler is required');
 let reads=0;
 const handler=mod.createFinalsHandler({authorize:async()=>null,runtime:async()=>{reads++;return null;}});
 const denied=await handler(new Request('http://localhost/api/photo-finals/x',{method:'POST',body:'not-json'}),'x');
 assert.equal(denied.status,401);assert.equal(reads,0);
 const disabled=mod.createFinalsHandler({authorize:async()=>({actorId:'x',scope:{},operator:true}),runtime:async()=>null});
 const response=await disabled(new Request('http://localhost/api/photo-finals/x'),'x');
 assert.equal(response.status,503);assert.equal((await response.json()).status,'disabled');
 assert.equal(response.headers.get('cache-control'),'private, no-store');
});
