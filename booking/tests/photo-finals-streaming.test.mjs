import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as transforms from '../lib/media/finals/transforms.ts';

test('stream emission is byte-identical to deterministic ZIP spool and fixed multipart sizes',async()=>{
 assert.equal(typeof transforms.streamStoredZip,'function');
 const dir=await mkdtemp(join(tmpdir(),'pf-zip-test-'));
 try{
  const inputs=[Buffer.alloc(9*1024*1024,17),Buffer.from('second')];
  const zip=await transforms.StoredZip.create(join(dir,'expected.zip'));
  for(const [n,b] of inputs.entries())await zip.add(`${String(n+1).padStart(3,'0')}.jpg`,b);
  await zip.finish();
  let calls=0;
  const entries=inputs.map((b,n)=>({name:`${String(n+1).padStart(3,'0')}.jpg`,load:async()=>{calls++;return b;}}));
  for(let pass=0;pass<2;pass++){
   const chunks=[];for await(const b of transforms.streamStoredZip(entries,AbortSignal.timeout(10000)))chunks.push(b);
   assert.ok(chunks.slice(0,-1).every(b=>b.length===8*1024*1024));
   assert.deepEqual(Buffer.concat(chunks),await readFile(join(dir,'expected.zip')));
  }
  assert.equal(calls,4);
 }finally{await rm(dir,{recursive:true,force:true});}
});
