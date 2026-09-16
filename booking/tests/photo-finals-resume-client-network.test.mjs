import test from 'node:test';import assert from 'node:assert/strict';
test('chunk retry is finite, abortable, and never retries authority denial',async()=>{
 const m=await import('../lib/media/resumable/network.ts').catch(()=>({}));assert.equal(typeof m.fetchChunk,'function');let calls=0;
 const deps={fetch:async()=>{calls++;return new Response(null,{status:calls===1?503:206})},delay:async()=>{}};
 assert.equal((await m.fetchChunk('/resume',new AbortController().signal,deps)).status,206);assert.equal(calls,2);
 calls=0;assert.equal((await m.fetchChunk('/resume',new AbortController().signal,{...deps,fetch:async()=>{calls++;return new Response(null,{status:403})}})).status,403);assert.equal(calls,1);
 calls=0;await assert.rejects(()=>m.fetchChunk('/resume',AbortSignal.abort(),deps));assert.equal(calls,0);
});
test('metadata reads cap incoming bytes and cancel overflow',async()=>{
 const m=await import('../lib/media/resumable/network.ts').catch(()=>({}));assert.equal(typeof m.metadataJson,'function');let cancelled=false;
 const r=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1_000_001));},cancel(){cancelled=true}}));
 await assert.rejects(()=>m.metadataJson(r));assert.equal(cancelled,true);
 assert.deepEqual(await m.metadataJson(Response.json({ok:true})),{ok:true});
});
