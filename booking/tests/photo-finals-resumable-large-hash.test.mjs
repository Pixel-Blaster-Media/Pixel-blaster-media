import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {incrementalHash} from '../lib/media/resumable/integrity.ts';
import {transfer} from '../lib/media/resumable/transfer.ts';

// Generated bounded buffers, independent Node oracle, never a package-sized allocation.
for(const size of [536870911,536870912,1100000000]){
 test(`whole SHA-256 agrees with Node at ${size} bytes across varied emitter boundaries`,async()=>{
  const h=incrementalHash(),oracle=createHash('sha256');
  const buffer=new Uint8Array(131073);for(let i=0;i<buffer.length;i++)buffer[i]=i%251;
  const widths=[1,55,56,63,64,65,131071,131072,131073];
  let offset=0,iteration=0;const baseline=process.memoryUsage();let peak=baseline;
  while(offset<size){const n=Math.min(widths[iteration++%widths.length],size-offset),b=buffer.subarray(0,n);h.update(b);oracle.update(b);offset+=n;
   if(iteration%1024===0){const m=process.memoryUsage();peak={rss:Math.max(peak.rss,m.rss),arrayBuffers:Math.max(peak.arrayBuffers,m.arrayBuffers)};}}
  assert.equal(await h.hex(),oracle.digest('hex'));
  console.log(JSON.stringify({tier:'Node incremental hash; generated bounded input',size,baseline,peak}));
  assert.ok(peak.arrayBuffers-baseline.arrayBuffers<32*1024*1024,'payload memory must not scale with package size');
 });
}

test('maximum production transfer resumes across 512 MiB and completes without erasing valid bytes',async()=>{
 const byteSize=1100000000,chunkSize=131072,count=Math.ceil(byteSize/chunkSize),resumeSize=536739840;
 const chunk=new Uint8Array(chunkSize).fill(0x61),whole=createHash('sha256'),chunkDigests=[];
 for(let offset=0;offset<byteSize;offset+=chunkSize){const b=chunk.subarray(0,Math.min(chunkSize,byteSize-offset));whole.update(b);chunkDigests.push(createHash('sha256').update(b).digest('hex'));}
 const m={byteSize,chunkSize,chunkCount:count,packageSha256:whole.digest('hex'),chunkDigests};
 // Test-only virtual disk reconstructs this deterministic fixture. Not OPFS/export evidence.
 let size=resumeSize,written=0,requests=0,reads=0,flushes=0;const truncations=[];
 const disk={getSize:()=>size,read:(b,{at})=>{assert.ok(at+b.length<=size);b.fill(0x61);reads++;return b.length;},write:(b,{at})=>{assert.equal(at,size);assert.deepEqual(b,chunk.subarray(0,b.length));size+=b.length;written+=b.length;return b.length;},truncate:n=>{size=n;truncations.push(n);},flush(){flushes++;}};
 const baseline=process.memoryUsage();let peak={...baseline};
 const result=await transfer(m,disk,async i=>{
  requests++;const start=i*chunkSize,length=Math.min(chunkSize,byteSize-start);assert.ok(start>=resumeSize);
  const memory=process.memoryUsage();peak.rss=Math.max(peak.rss,memory.rss);peak.arrayBuffers=Math.max(peak.arrayBuffers,memory.arrayBuffers);
  // Arbitrary network emitter boundaries, distinct from the digest/index chunk boundary.
  let offset=0;const widths=[1,55,65537,131072];let part=0;
  const body=new ReadableStream({pull(controller){if(offset===length){controller.close();return;}const end=Math.min(length,offset+widths[part++%widths.length]);controller.enqueue(chunk.subarray(offset,end));offset=end;}});
  return new Response(body,{status:206,headers:{'Content-Length':String(length),'Content-Range':`bytes ${start}-${start+length-1}/${byteSize}`,ETag:`"${m.packageSha256}"`,'X-Chunk-Sha256':chunkDigests[i]}});
 },new AbortController().signal,()=>{});
 assert.equal(result.state,'ready');assert.equal(result.sha256,m.packageSha256);assert.equal(result.bytes,byteSize);assert.equal(result.resumedAt,resumeSize);
 assert.equal(size,byteSize);assert.equal(written,byteSize-resumeSize);assert.equal(reads,resumeSize/chunkSize);assert.equal(requests,count-reads);assert.deepEqual(truncations,[resumeSize]);assert.equal(flushes,requests+1);
 assert.ok(peak.arrayBuffers-baseline.arrayBuffers<64*1024*1024,'transfer payload memory must stay bounded');
 console.log(JSON.stringify({tier:'actual consumer; synthetic bounded responses and virtual disk, NOT OPFS/iOS export',byteSize,requests,reads,written,finalSize:size,truncations,result,baseline,peak}));
});

test('true whole-package mismatch still truncates to zero, flushes and errors',async()=>{
 const chunk=new Uint8Array([1,2,3]),chunkSha=createHash('sha256').update(chunk).digest('hex');
 const m={byteSize:3,chunkSize:131072,chunkCount:1,packageSha256:'0'.repeat(64),chunkDigests:[chunkSha]};
 let size=0,flushes=0;const truncations=[];
 const disk={getSize:()=>size,read:()=>assert.fail('empty disk'),write:b=>{size+=b.length;return b.length;},truncate:n=>{size=n;truncations.push(n);},flush(){flushes++;}};
 await assert.rejects(()=>transfer(m,disk,async()=>new Response(chunk,{status:206,headers:{'Content-Length':'3','Content-Range':'bytes 0-2/3',ETag:`"${m.packageSha256}"`,'X-Chunk-Sha256':chunkSha}}),new AbortController().signal,()=>{}),{message:'package_integrity'});
 assert.equal(size,0);assert.deepEqual(truncations,[0,0]);assert.equal(flushes,3);
});
