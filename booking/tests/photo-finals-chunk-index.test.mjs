import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const load=()=>import('../lib/media/finals/chunk-index.ts');
const binding={organization_id:'11111111-1111-4111-8111-111111111111',package_id:'22222222-2222-4222-8222-222222222222',release_id:'33333333-3333-4333-8333-333333333333',manifest_sha256:'ab'.repeat(32)};
test('canonical fixed binary index binds all fields and detects tampering',async()=>{
 const {ChunkIndexHasher,makeChunkIndex,encodeChunkIndex,verifyChunkIndex}=await load();
 const h=new ChunkIndexHasher();h.update(Buffer.from('hello'));const i=makeChunkIndex(binding,h.finish());
 const expected=Buffer.concat([Buffer.from('PFCHIDX1'),...['organization_id','package_id','release_id'].map(k=>Buffer.from(binding[k].replaceAll('-',''),'hex')),Buffer.from(binding.manifest_sha256,'hex'),Buffer.from(hash(Buffer.from('hello')),'hex'),Buffer.from('00000000000000050002000000000001','hex'),Buffer.from(hash(Buffer.from('hello')),'hex')]);
 assert.deepEqual(encodeChunkIndex(i),expected);assert.equal(i.index_sha256,hash(expected));assert.equal(verifyChunkIndex(i),true);
 for(const patch of [{byte_size:6},{manifest_sha256:'cd'.repeat(32)},{digests:'00'.repeat(32)},{chunk_count:2},{version:2},{chunk_size:65536},{package_id:binding.release_id}])assert.throws(()=>verifyChunkIndex({...i,...patch}),/finals_index/);
});
test('aligned digest vector is independent of emitter boundaries',async()=>{
 const {ChunkIndexHasher}=await load();
 const bytes=Buffer.alloc(262151);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const a=new ChunkIndexHasher();for(let i=0;i<bytes.length;i+=777)a.update(bytes.subarray(i,i+777));
 const result=a.finish();assert.equal(result.bytes,bytes.length);assert.equal(result.sha256,hash(bytes));
 assert.equal(result.digests,Buffer.concat([bytes.subarray(0,131072),bytes.subarray(131072,262144),bytes.subarray(262144)].map(b=>Buffer.from(hash(b),'hex'))).toString('hex'));
});
