// Independent timing seam: only Sharp native work and wall clock are synthetic.
import {mock} from 'node:test';
import assert from 'node:assert/strict';
let clock=100000,events=[],validationMs=29000,onValidation=()=>{};
const sharp=()=>{
 const pipeline={timeout({seconds}){assert.equal(seconds,30);return this;},
  async metadata(){events.push({step:'validation',at:clock});return {format:'jpeg',width:1,height:1};},
  async stats(){clock+=validationMs;onValidation();return {};},
  rotate(){return this;},resize(){return this;},toColourspace(){return this;},jpeg(){return this;},
  async toBuffer(){events.push({step:'encode',at:clock});clock+=30000;return {data:Buffer.from('jpeg'),info:{width:1,height:1}};}};
 return pipeline;
};
sharp.versions={sharp:'0.35.4',vips:'8.18.6',mozjpeg:'0826579'};
mock.module('sharp',{defaultExport:sharp});
const {transformFinalJpeg}=await import('../../lib/media/finals/transforms.ts');
const {finalsDeadline}=await import('../../lib/media/finals/operator-deadline.ts');
const now=Date.now;Date.now=()=>clock;
const bytes=Buffer.from([255,216,255,217]);
try{
 const deadline=finalsDeadline(131000);
 try{
  deadline.check(30000); // The reviewed caller's admission succeeds.
  await assert.rejects(transformFinalJpeg(bytes,'gallery',deadline),/finals_operator_budget/);
  assert.deepEqual(events,[{step:'validation',at:100000}]);
  console.log(JSON.stringify({case:'B1',productionTransform:true,syntheticNativeTiming:true,workDeadline:131000,events,remaining:131000-clock,encodeRefused:true}));
 }finally{deadline.close();}
 // First-stage admission, equality boundary, cancellation, and admitted success.
 for(const scenario of ['no-validation-reserve','exact-encode-reserve','cancel-before','cancel-between','fits']){
  clock=100000;events=[];validationMs=scenario==='exact-encode-reserve'?1000:29000;
  const deadline=finalsDeadline(scenario==='no-validation-reserve'?130000:scenario==='fits'?161000:scenario.startsWith('cancel')?200000:131000);
  const controller=new AbortController(),reason=new Error('lease_cancelled');
  const execution={signal:AbortSignal.any([deadline.signal,controller.signal]),check:deadline.check};
  onValidation=()=>{if(scenario==='cancel-between')controller.abort(reason);};
  if(scenario==='cancel-before')controller.abort(reason);
  try{
   if(scenario==='fits'){
    const result=await transformFinalJpeg(bytes,'mls',execution);
    assert.equal(result.width,1);assert.deepEqual(events.map(e=>e.step),['validation','encode']);assert.ok(clock<161000);
   }else{
    await assert.rejects(transformFinalJpeg(bytes,'gallery',execution),scenario.startsWith('cancel')?/lease_cancelled/:/finals_operator_budget/);
    assert.deepEqual(events.map(e=>e.step),scenario==='no-validation-reserve'||scenario==='cancel-before'?[]:['validation']);
   }
   console.log(JSON.stringify({case:scenario,events,passed:true}));
  }finally{deadline.close();}
 }
}finally{Date.now=now;mock.restoreAll();}
