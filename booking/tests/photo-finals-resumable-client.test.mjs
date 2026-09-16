import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const load=()=>import('../lib/media/resumable/integrity.ts').catch(()=>({}));
test('client rejects denial, bad status/range/length/hash before writing any bytes',async()=>{
 const {transfer}=await import('../lib/media/resumable/transfer.ts');const b=new Uint8Array([1,2,3]),sha=createHash('sha256').update(b).digest('hex');
 const m={byteSize:3,chunkSize:131072,chunkCount:1,packageSha256:sha,chunkDigests:[sha]};
 const headers={'Content-Length':'3','Content-Range':'bytes 0-2/3',ETag:`"${sha}"`,'X-Chunk-Sha256':sha};
 for(const fault of ['denied','status','range','short','overflow','hash']){let writes=0;
 const disk={getSize:()=>0,truncate(){},flush(){},write(){writes++;return 3;}};
 const r=new Response(fault==='short'?b.slice(0,2):fault==='overflow'?new Uint8Array(4):fault==='hash'?new Uint8Array(3):b,{status:fault==='denied'?403:fault==='status'?200:206,headers:{...headers,...(fault==='range'?{'Content-Range':'bytes 1-3/3'}:{})}});
 await assert.rejects(()=>transfer(m,disk,async()=>r,new AbortController().signal,()=>{}));assert.equal(writes,0,fault);
 }
});
test('incremental exact production hasher matches independent Node SHA over bounded updates',async()=>{
 const {incrementalHash}=await load(); assert.equal(typeof incrementalHash,'function','incremental hash implementation is missing');
 const h=incrementalHash(), oracle=createHash('sha256');
 for(let i=0;i<100;i++){const b=new Uint8Array(131072).fill(i);h.update(b);oracle.update(b);}
 assert.equal(await h.hex(),oracle.digest('hex'));
});

test('disk resume rehashes valid prefix, truncates corrupt tail, streams exact verified remainder',async()=>{
 const mod=await import('../lib/media/resumable/transfer.ts').catch(()=>({}));
 assert.equal(typeof mod.transfer,'function','OPFS transfer implementation missing');
 const source=new Uint8Array(262151);source.forEach((_,i)=>source[i]=i%251);
 const sha=b=>createHash('sha256').update(b).digest('hex');
 const m={transferId:'00000000-0000-4000-8000-000000000001',packageId:'00000000-0000-4000-8000-000000000002',packageSha256:sha(source),indexSha256:'a'.repeat(64),byteSize:source.length,chunkSize:131072,chunkCount:3,chunkDigests:[sha(source.slice(0,131072)),sha(source.slice(131072,262144)),sha(source.slice(262144))]};
 let disk=source.slice(0,262144);disk[131073]^=1;const calls=[];
 const access={getSize:()=>disk.length,read:(b,{at})=>{b.set(disk.subarray(at,at+b.length));return b.length},write:(b,{at})=>{const next=new Uint8Array(at+b.length);next.set(disk.subarray(0,at));next.set(b,at);disk=next;return b.length},truncate:n=>{disk=disk.slice(0,n)},flush(){}};
 const result=await mod.transfer(m,access,async i=>{calls.push(i);const start=i*131072,end=Math.min(start+131072,source.length);return new Response(source.slice(start,end),{status:206,headers:{'Content-Length':String(end-start),'Content-Range':`bytes ${start}-${end-1}/${source.length}`,ETag:`"${m.packageSha256}"`,'X-Chunk-Sha256':m.chunkDigests[i]}})},new AbortController().signal,()=>{});
 assert.equal(result.resumedAt,131072);assert.deepEqual(calls,[1,2]);assert.deepEqual(disk,source);assert.equal(result.sha256,m.packageSha256);
});

test('metadata rejects malformed geometry and digest vectors before allocating payload',async()=>{
 const mod=await import('../lib/media/resumable/metadata.ts').catch(()=>({}));assert.equal(typeof mod.validateMetadata,'function','metadata validation missing');
 const good={transferId:'00000000-0000-4000-8000-000000000001',packageId:'00000000-0000-4000-8000-000000000002',packageSha256:'a'.repeat(64),indexSha256:'b'.repeat(64),byteSize:131073,chunkSize:131072,chunkCount:2,chunkDigests:['c'.repeat(64),'d'.repeat(64)]};
 assert.deepEqual(mod.validateMetadata(good),good);
 for(const delta of [{chunkSize:2},{byteSize:1100000001},{chunkCount:9000},{chunkDigests:['x']},{indexSha256:'../x'},{transferId:'bad'}])assert.throws(()=>mod.validateMetadata({...good,...delta}));
});
