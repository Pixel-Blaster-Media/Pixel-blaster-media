import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinalsHandler} from '../lib/media/finals/http.ts';
import {fixture,scope} from './helpers/photo-finals-operator-fixture.mjs';
const req=()=>new Request('http://localhost/api/photo-finals/'+scope.bookingId,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:'{"op":"work"}'});
test('expired admission never schedules or accesses SQL',async()=>{
 const f=fixture();const r=await createFinalsHandler(f.deps)(req(),scope.bookingId,Date.now()-21000);
 assert.equal(r.status,503);assert.equal(f.callbacks.length,0);assert.equal(f.calls.length,0);
});
test('late callback does not start a claim after the absolute work deadline',async()=>{
 const f=fixture();const now=Date.now;let clock=now();Date.now=()=>clock;
 try{assert.equal((await createFinalsHandler(f.deps)(req(),scope.bookingId,clock)).status,202);clock+=221000;await f.callbacks[0]();assert.equal(f.calls.includes('photo_finals_package_due'),false);}finally{Date.now=now;}
});
test('package does not claim when bounded decoder tail cannot fit',async()=>{
 const {processFinalRelease}=await import('../lib/media/finals/packages.ts');const f=fixture();
 await assert.rejects(processFinalRelease({...f.runtime,scope,jobId:'41111111-1111-4111-8111-111111111101',workerId:'test',deadlines:{work:Date.now()+100,settlement:Date.now()+1000}}),/budget/);
 assert.equal(f.calls.includes('photo_finals_package_claim'),false);
});
