import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import Renderer, {act} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadSource} from './helpers/source-module.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const policy = loadSource('lib/booking/catalog-upload-policy.ts');
const check = loadSource('lib/booking/catalog-preparation-check.ts');
const props = {title:"One'er",catalogItemId:'owned-catalog',size:227010474,fingerprint:'a'.repeat(64),alreadyAttempted:false};
const storageKey = check.PREPARATION_CHECK_STORAGE;
const previousOperation = 'b02f0969-4523-4c3b-afd5-28713cffcd01';
const approvedOperation = '1e2d1c53-403a-40cc-a108-5cbce90bcafc';
const runLabel = 'Run new preparation test';
async function setup({storage=new Map(),response,fetchOutcome,uncertain=false,malformed=false,storageDenied=false,
  storageReadDenied=false,storageWriteFailureAt=0,alreadyAttempted=false}={}) {
  const requests=[],copied=[];
  let writes=0;
  const Component=loadSource('app/admin/settings/pricing/upload-preparation/PreparationCheck.tsx',{
    react:React,'react/jsx-runtime':jsxRuntime,'@/lib/booking/catalog-preparation-check':check,
  },{AbortSignal,localStorage:{getItem(k){if(storageReadDenied)throw Error('denied');return storage.get(k)??null;},
    setItem(k,v){writes++;if(storageDenied||writes===storageWriteFailureAt)throw Error('denied');storage.set(k,v);}},
    navigator:{clipboard:{writeText:async value=>copied.push(value)}},
    fetch:async(url,init)=>{
      requests.push({url,init});
      assert.equal(storage.get(storageKey),'attempt-started-no-retry');
      if(fetchOutcome)return fetchOutcome({url,init});
      if(uncertain) throw Error('private-provider-error');
      if(malformed)return new Response('private-response',{status:503});
      return response??Response.json({exampleId:'owned-example',uploadUrl:'https://upload.videodelivery.net/private-capability'});
    },
  }).default;
  let tree;
  await act(async()=>{tree=Renderer.create(React.createElement(React.StrictMode,null,React.createElement(Component,{...props,alreadyAttempted})));});
  const button=name=>tree.root.findAllByType('button').find(n=>n.children.join('')===name);
  return {tree,requests,storage,copied,button,async unmount(){await act(async()=>tree.unmount());}};
}

test('the fresh approval uses one distinct fixed operation sourced from the consumed test',()=>{
  assert.equal(check.PREPARATION_CHECK_SOURCE,previousOperation);
  assert.equal(check.PREPARATION_CHECK_OPERATION,approvedOperation);
  assert.notEqual(check.PREPARATION_CHECK_OPERATION,check.PREPARATION_CHECK_SOURCE);
  assert.equal(storageKey,`pixel-blaster-preparation-only:${approvedOperation}`);
});

test('approved check mounts without I/O, sends one metadata request on click, and never exposes or follows a capability',async()=>{
  const a=await setup();
  assert.equal(a.requests.length,0);
  assert.equal(a.tree.root.findAllByType('input').length,0);
  const click=a.button(runLabel).props.onClick;
  await act(async()=>{click();click();});
  assert.equal(a.requests.length,1);
  const {url,init}=a.requests[0];
  assert.equal(url,'/api/admin/catalog-examples/upload');assert.equal(init.method,'POST');
  assert.equal(init.redirect,'error');assert.equal(init.credentials,'same-origin');
  assert.deepEqual(JSON.parse(init.body),{protocol:'tus',catalogItemId:props.catalogItemId,title:props.title,
    description:'',size:props.size,fingerprint:props.fingerprint,idempotencyKey:check.PREPARATION_CHECK_OPERATION});
  assert.equal(a.button(runLabel),undefined);
  assert.match(JSON.stringify(a.tree.toJSON()),/Preparation succeeded/);
  await act(async()=>a.button('Copy safe report').props.onClick());
  assert.equal(JSON.parse(a.copied[0]).videoBytesSent,0);
  assert.equal(JSON.parse(a.copied[0]).retryAllowed,false);
  assert.doesNotMatch(JSON.stringify({view:a.tree.toJSON(),saved:[...a.storage],copied:a.copied}),/private-capability|owned-example|uploadUrl/);
  await a.unmount();
  const reloaded=await setup({storage:a.storage,alreadyAttempted:true});
  assert.equal(reloaded.requests.length,0);assert.equal(reloaded.button(runLabel),undefined);
  assert.match(JSON.stringify(reloaded.tree.toJSON()),/Preparation succeeded/);await reloaded.unmount();
});

test('failed and uncertain outcomes remain locked across remount and keep only safe diagnostics',async()=>{
  for(const settings of [
    {response:Response.json({error:'private-error',inspection:{verified:false,stage:'capability_validation',httpStatus:201,
      checks:{uidValid:true,capabilityAllowedHost:false,capabilityPath:'private-url',extra:'private-value'},
      expiryChecks:{exactMatch:false,sameWholeSecond:true,raw:'private-date'},uploadUrl:'private-capability'}},{status:503})},
    {uncertain:true},{malformed:true},
  ]) {
    const a=await setup(settings);await act(async()=>a.button(runLabel).props.onClick());
    assert.equal(a.requests.length,1);assert.equal(a.button(runLabel),undefined);
    const saved=JSON.parse(a.storage.get(storageKey));
    assert.equal(saved.retryAllowed,false);assert.equal(saved.videoBytesSent,0);
    if(settings.response) {assert.equal(saved.inspection.checks.capabilityAllowedHost,false);assert.equal(saved.inspection.expiryChecks.sameWholeSecond,true);}
    assert.doesNotMatch(JSON.stringify({view:a.tree.toJSON(),saved}),/private-|uploadUrl/);
    await a.unmount();const reloaded=await setup({storage:a.storage});
    assert.equal(reloaded.requests.length,0);assert.equal(reloaded.button(runLabel),undefined);await reloaded.unmount();
  }
});

test('existing attempts and unavailable lock storage prevent any request',async()=>{
  for(const settings of [{alreadyAttempted:true},{storage:new Map([[storageKey,'attempt-started-no-retry']])},
    {storageReadDenied:true},{storageDenied:true}]) {
    const a=await setup(settings);
    if(a.button(runLabel))await act(async()=>a.button(runLabel).props.onClick());
    assert.equal(a.requests.length,0);assert.equal(a.button(runLabel),undefined);await a.unmount();
  }
});

test('the previous report stays untouched while only the new approved operation can run',async()=>{
  const previousKey=`pixel-blaster-preparation-only:${previousOperation}`;
  const previousReport=JSON.stringify({operationId:previousOperation,httpStatus:503,prepared:false,
    videoBytesSent:0,retryAllowed:false,inspection:null});
  const storage=new Map([[previousKey,previousReport]]);
  assert.equal(check.readPreparationCheckReport(previousReport),null);
  const a=await setup({storage});assert.equal(a.requests.length,0);
  await act(async()=>a.button(runLabel).props.onClick());
  assert.equal(a.requests.length,1);
  assert.equal(JSON.parse(a.requests[0].init.body).idempotencyKey,approvedOperation);
  assert.equal(storage.get(previousKey),previousReport);
  assert.equal(JSON.parse(storage.get(storageKey)).operationId,approvedOperation);
  await a.unmount();
  const reentered=await setup({storage});
  assert.equal(reentered.requests.length,0);assert.equal(reentered.button(runLabel),undefined);await reentered.unmount();
  const mismatched=await setup({storage:new Map([[storageKey,previousReport]])});
  assert.equal(mismatched.requests.length,0);assert.equal(mismatched.button(runLabel),undefined);await mismatched.unmount();
});

test('pending requests block double clicks, another mounted view and refresh without retry',async()=>{
  const storage=new Map();let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const first=await setup({storage,fetchOutcome:()=>pending});
  const second=await setup({storage});
  const firstClick=first.button(runLabel).props.onClick;
  const secondClick=second.button(runLabel).props.onClick;
  await act(async()=>{firstClick();firstClick();secondClick();});
  assert.equal(first.requests.length,1);assert.equal(second.requests.length,0);
  assert.equal(first.button('Checking preparation…').props.disabled,true);
  await first.unmount();
  const refreshed=await setup({storage});
  assert.equal(refreshed.requests.length,0);assert.equal(refreshed.button(runLabel),undefined);
  await act(async()=>finish(Response.json({error:'private-provider-error'},{status:503})));
  await act(async()=>{firstClick();secondClick();});
  assert.equal(first.requests.length,1);assert.equal(second.requests.length,0);
  assert.equal(JSON.parse(storage.get(storageKey)).retryAllowed,false);
  await second.unmount();await refreshed.unmount();
  const reentered=await setup({storage});
  assert.equal(reentered.requests.length,0);assert.equal(reentered.button(runLabel),undefined);await reentered.unmount();
});

test('HTTP failures, aborts and failed result persistence never re-arm the operation',async()=>{
  for(const code of [401,403,409,429,503]) {
    const a=await setup({response:Response.json({error:'private-provider-error'},{status:code})});
    const click=a.button(runLabel).props.onClick;await act(async()=>click());await act(async()=>click());
    assert.equal(a.requests.length,1);assert.equal(JSON.parse(a.storage.get(storageKey)).httpStatus,code);
    await a.unmount();const reentered=await setup({storage:a.storage});
    assert.equal(reentered.requests.length,0);assert.equal(reentered.button(runLabel),undefined);await reentered.unmount();
  }
  const aborted=await setup({fetchOutcome:async()=>{throw new DOMException('private-abort','AbortError');}});
  await act(async()=>aborted.button(runLabel).props.onClick());
  assert.equal(aborted.requests.length,1);assert.equal(JSON.parse(aborted.storage.get(storageKey)).prepared,null);
  await aborted.unmount();const afterAbort=await setup({storage:aborted.storage});
  assert.equal(afterAbort.requests.length,0);assert.equal(afterAbort.button(runLabel),undefined);await afterAbort.unmount();
  const failedSave=await setup({storageWriteFailureAt:2});
  await act(async()=>failedSave.button(runLabel).props.onClick());
  assert.equal(failedSave.requests.length,1);assert.equal(failedSave.storage.get(storageKey),'attempt-started-no-retry');
  await failedSave.unmount();const afterFailedSave=await setup({storage:failedSave.storage});
  assert.equal(afterFailedSave.requests.length,0);assert.equal(afterFailedSave.button(runLabel),undefined);await afterFailedSave.unmount();
});

function pageFixture({denied=false,foreign=false,error=false,pending=false,attempted=false}={}) {
  const calls=[],captured=[];
  const db={from(table){const filters=[];let selected;const q={select(value){selected=value;return q;},eq(k,v){filters.push([k,v]);return q;},
    async maybeSingle(){calls.push({table,selected,filters});
      if(error)return {data:null,error:{message:'private-database-error'}};
      if(filters.some(([k,v])=>k==='id'&&v===check.PREPARATION_CHECK_OPERATION))return {data:attempted?{id:check.PREPARATION_CHECK_OPERATION}:null,error:null};
      return {data:foreign?null:{catalog_item_id:props.catalogItemId,upload_size:props.size,upload_fingerprint:props.fingerprint,state:pending?'cleanup_required':'cleaned'},error:null};
    }};return q;}};
  const Page=loadSource('app/admin/settings/pricing/upload-preparation/page.tsx',{
    'react/jsx-runtime':jsxRuntime,'next/link':{default:({children,href,...rest})=>React.createElement('a',{href,...rest},children)},
    'next/navigation':{notFound(){throw Error('NOT_FOUND');}},
    '@/lib/auth/require-admin':{requireAdmin:async()=>{if(denied)throw Error('AUTH_REQUIRED');return {organizationId:'owned-org'};}},
    '@/lib/supabase/server':{getServiceSupabase:()=>db},'@/lib/booking/catalog-upload-policy':policy,
    '@/lib/booking/catalog-preparation-check':check,'./PreparationCheck':{default:p=>{captured.push(p);return React.createElement('div',null,'check');}},
  }).default;
  return {calls,captured,async render(title=props.title){return renderToStaticMarkup(await Page({searchParams:Promise.resolve({title})}));}};
}

test('preparation page requires admin before reads and only projects company-scoped original metadata',async()=>{
  const denied=pageFixture({denied:true});await assert.rejects(denied.render(),/AUTH_REQUIRED/);assert.equal(denied.calls.length,0);
  const foreign=pageFixture({foreign:true});await assert.rejects(foreign.render(),/NOT_FOUND/);assert.equal(foreign.captured.length,0);
  const allowed=pageFixture();await allowed.render();assert.equal(allowed.calls.length,2);
  for(const call of allowed.calls){assert.equal(call.table,'catalog_stream_upload_claims');assert.ok(call.filters.some(([k,v])=>k==='organization_id'&&v==='owned-org'));assert.doesNotMatch(call.selected,/stream_uid|upload_url|\*/);}
  assert.deepEqual(allowed.calls.map(call=>call.filters.find(([k])=>k==='id')[1]),[previousOperation,approvedOperation]);
  assert.equal(allowed.captured[0].size,227010474);assert.equal(allowed.captured[0].alreadyAttempted,false);
  const used=pageFixture({attempted:true});await used.render();assert.equal(used.captured[0].alreadyAttempted,true);
  for(const options of [{error:true},{pending:true}]){const blocked=pageFixture(options);assert.match(await blocked.render(),/test is unavailable/);assert.equal(blocked.captured.length,0);}
  const invalid=pageFixture();await assert.rejects(invalid.render(''),/NOT_FOUND/);assert.equal(invalid.calls.length,0);
});

test('saved reports are re-sanitized and cannot inject URLs, provider values or unknown stages',()=>{
  const report=check.readPreparationCheckReport(JSON.stringify({operationId:check.PREPARATION_CHECK_OPERATION,prepared:false,httpStatus:503,
    videoBytesSent:0,retryAllowed:false,uploadUrl:'private-capability',inspection:{stage:'restriction_verification',verified:false,httpStatus:200,
      checks:{expiry:false,allowedOrigin:true,uid:'private-uid'},expiryChecks:{exactMatch:false,raw:'private-date'}}}));
  assert.equal(report.inspection.checks.expiry,false);assert.doesNotMatch(JSON.stringify(report),/private-|uploadUrl/);
  assert.equal(check.readPreparationCheckReport('{"operationId":"different"}'),null);
  assert.equal(check.preparationCheckReport({inspection:{stage:'private-stage'}},503).inspection,null);
});
