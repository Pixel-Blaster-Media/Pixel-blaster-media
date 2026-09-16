import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
test('durable client journal reuses exact same file intent and isolates actors and bookings',async()=>{
 const m=await import('../lib/media/finals/upload-journal.ts').catch(()=>null);assert.ok(m,'persistent upload journal is required');
 const values=new Map();const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 const identity=randomUUID()+':'+randomUUID()+':'+randomUUID(),other=randomUUID();
 const file={sha256:'a'.repeat(64),byteSize:15};
 const a=m.rememberUpload(storage,identity,file),b=m.rememberUpload(storage,identity,file);
 assert.deepEqual(a,b);assert.notEqual(m.rememberUpload(storage,other,file).intentId,a.intentId);
 const next=m.rememberUpload(storage,identity,{...file,sha256:'b'.repeat(64)});assert.equal(next.requestId,a.requestId);assert.notEqual(next.intentId,a.intentId);
 assert.equal(values.size,2);assert.ok(![...values.values()].join('').includes('url'));
});
