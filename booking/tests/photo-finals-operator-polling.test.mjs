import test from 'node:test';
import assert from 'node:assert/strict';
test('polling has no overlap, aborts hidden/unmounted reads, and never posts',async()=>{
 const {startFinalsPolling}=await import('../lib/media/finals/operator-polling.ts');
 const visibility=new EventTarget();visibility.hidden=false;let reads=0,signal,release;
 const stop=startFinalsPolling({visibility,read:async s=>{reads++;signal=s;await new Promise(r=>release=r);return true;},onStop:()=>{},initialMs:5,maxMs:10,budgetMs:1000});
 await new Promise(r=>setTimeout(r,20));assert.equal(reads,1);await new Promise(r=>setTimeout(r,20));assert.equal(reads,1);
 visibility.hidden=true;visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(signal.aborted,true);release();
 await new Promise(r=>setTimeout(r,20));assert.equal(reads,1);
 visibility.hidden=false;visibility.dispatchEvent(new Event('visibilitychange'));await new Promise(r=>setTimeout(r,20));assert.equal(reads,2);
 stop();assert.equal(signal.aborted,true);release();await new Promise(r=>setTimeout(r,20));assert.equal(reads,2);
});
test('terminal result and finite session budget stop future reads',async()=>{
 const {startFinalsPolling}=await import('../lib/media/finals/operator-polling.ts');
 for(const terminal of [true,false]){
  const visibility=new EventTarget();visibility.hidden=false;let reads=0,stopped=0;
  const stop=startFinalsPolling({visibility,read:async()=>{reads++;return !terminal;},onStop:()=>stopped++,initialMs:5,maxMs:10,budgetMs:35});
  await new Promise(r=>setTimeout(r,70));const count=reads;await new Promise(r=>setTimeout(r,30));assert.equal(reads,count);assert.equal(stopped,1);if(terminal)assert.equal(reads,1);stop();
 }
});
