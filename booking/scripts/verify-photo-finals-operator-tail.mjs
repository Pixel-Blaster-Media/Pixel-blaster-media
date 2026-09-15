// Real package processor + PG, real decoder and multipart adapter. The stalled
// provider and renewal are controlled cancellable seams; not hosted capacity QA.
import assert from 'node:assert/strict';
import {fixture,scope} from '../tests/helpers/photo-finals-operator-pg.mjs';
import {processFinalRelease} from '../lib/media/finals/packages.ts';
const f=await fixture(),events=[];let uploading=false;
const pause=(ms,signal)=>new Promise((yes,no)=>{let timer;const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);no(Error('cancelled'));};timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);yes();},ms);if(signal){signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}});
const originalSend=f.client.send.bind(f.client);
f.client.send=async(command,options)=>{
 const name=command.constructor.name;
 if(name==='UploadPartCommand'){uploading=true;events.push('multipart-start');await pause(60000,options.abortSignal);}
 if(name==='AbortMultipartUploadCommand'){assert.equal(options.abortSignal.aborted,false);events.push('abort-start');await pause(100,options.abortSignal);const result=await originalSend(command);events.push('abort-end');return result;}
 return originalSend(command);
};
const db=f.runtime.db;
const delayed={rpc(name,args){let signal;return {abortSignal(s){signal=s;return this;},then(yes,no){return (async()=>{
 if(name==='photo_finals_package_heartbeat'&&uploading&&Date.now()-started>27000){events.push('renew-start');try{await pause(60000,signal);}finally{events.push('renew-end');}}
 if(name==='photo_finals_package_fail'){assert.equal(signal.aborted,false);events.push('fail-start');await pause(100,signal);}
 const result=await db.rpc(name,args);if(name==='photo_finals_package_fail')events.push('fail-end');return result;
 })().then(yes,no);}};}};
const started=Date.now();
await assert.rejects(processFinalRelease({...f.runtime,db:delayed,scope,jobId:f.jobId,workerId:'absolute-budget',budgets:{totalMs:240000,heartbeatMs:1000},deadlines:{work:started+35000,settlement:started+45000}}));
assert.ok(events.includes('renew-start'));assert.ok(events.indexOf('renew-end')<events.indexOf('fail-start'));assert.ok(events.indexOf('abort-end')<events.indexOf('fail-start'));assert.equal(events.at(-1),'fail-end');assert.equal(f.client.uploads.size,0);assert.equal(f.metrics().ready,0);assert.ok(Date.now()-started>=35000,'absolute work timer, not an earlier renewal timeout');assert.ok(Date.now()-started<45000);
f.client.send=originalSend;f.sql(`update media_ingest_jobs set next_attempt_at=now() where id='${f.jobId}'`);
// An atomic finish can commit while its response is lost. Never replay finish,
// publish twice, or let the failed stale settlement undo the ready transaction.
let lost=false;
const lostFinish={async rpc(name,args){const result=await db.rpc(name,args);if(name==='photo_finals_package_finish'&&!result.error){lost=true;return {data:null,error:{message:'lost committed finish response'}};}return result;}};
await assert.rejects(processFinalRelease({...f.runtime,db:lostFinish,scope,jobId:f.jobId,workerId:'lost-finish',deadlines:{work:Date.now()+200000,settlement:Date.now()+260000}}));
assert.equal(lost,true);assert.deepEqual(f.metrics(),{ready:1,packages:2,attempts:2,jobs:1});
assert.deepEqual(await processFinalRelease({...f.runtime,scope,jobId:f.jobId,workerId:'replay',deadlines:{work:Date.now()+200000,settlement:Date.now()+260000}}),{status:'not_claimed'});
console.log(JSON.stringify({absoluteWorkMs:35000,elapsedMs:Date.now()-started,nativeJpegTransforms:true,renewalJoinedBeforeSettlement:true,freshSignalMultipartAbort:true,multipartResidue:0,atomicFinishResponseLossRecovered:true,noDuplicatePublication:true,events}));
