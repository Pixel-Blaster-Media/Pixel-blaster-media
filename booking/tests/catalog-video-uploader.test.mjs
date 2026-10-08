import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import Renderer,{act} from 'react-test-renderer';
import {loadSource} from './helpers/source-module.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const policy=loadSource('lib/booking/catalog-upload-policy.ts');
const transport=loadSource('lib/booking/catalog-upload-transport.ts');
const completion=loadSource('lib/booking/catalog-video-completion.ts',{}, {AbortController,setTimeout,clearTimeout});
async function setup({prepareError=false,cancelError=false,completionReply}={}){
 const requests=[],busy=[];let options,starts=0,aborts=0,complete=0;
 const fetch=async(url,init)=>{requests.push({url,init});if(url.endsWith('/complete'))return completionReply?.(url,init)??Response.json({error:'Mock check unavailable'},{status:503});
  if(prepareError)return Response.json({error:'Mock preparation rejected'},{status:503});
  return Response.json({exampleId:'owned-example',uploadUrl:'https://upload.videodelivery.net/mock',expiresAt:new Date(Date.now()+3600_000).toISOString(),resumed:false});};
 const Uploader=loadSource('app/admin/settings/pricing/CatalogVideoUploader.tsx',{
  react:React,'react/jsx-runtime':jsxRuntime,
  '@/lib/booking/catalog-upload-policy':{...policy,catalogFileFingerprint:async()=> 'a'.repeat(64)},
  '@/lib/booking/catalog-upload-transport':transport,
  '@/lib/booking/catalog-video-completion':{waitForCatalogVideoCompletion:(id,opts)=>completion.waitForCatalogVideoCompletion(id,{...opts,fetchImpl:fetch,sleep:async()=>{}})},
  './example-actions':{deleteCatalogExample:async id=>{requests.push({cancel:id});return cancelError?{ok:false,error:'Mock cancellation failed'}:{ok:true};}},
 },{AbortSignal,AbortController,crypto,setTimeout,XMLHttpRequest:undefined,fetch,
 }).default;
 let tree;await act(async()=>{tree=Renderer.create(React.createElement(React.StrictMode,null,React.createElement(Uploader,{
  catalogItemId:'owned-catalog',onBusyChange:x=>busy.push(x),onComplete:()=>{complete++},
  createTransfer:async(file,o)=>{options=o;return {start(){starts++},async abort(){aborts++}}},
 })));});
 const button=name=>tree.root.findAllByType('button').find(n=>n.children.join('')===name);
 const title=value=>tree.root.findAllByType('input')[0].props.onChange({target:{value}});
 const file=size=>tree.root.findAllByType('input').find(n=>n.props.type==='file').props.onChange({target:{files:[{size,type:'video/mp4'}]}});
 const submit=()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}});
 await act(async()=>{title('Sample video');file(500_000_000)});
 return {tree,requests,busy,button,title,file,submit,get options(){return options},get starts(){return starts},get aborts(){return aborts},get complete(){return complete}};
}
test('actual uploader sends bounded metadata, tracks progress, pauses/resumes and aborts on unmount',async()=>{
 const a=await setup();await act(async()=>a.submit());assert.equal(a.starts,1);
 const payload=JSON.parse(a.requests[0].init.body);assert.equal(payload.size,500_000_000);assert.equal(payload.protocol,'tus');assert.equal(payload.title,'Sample video');assert.equal(a.options.storeFingerprintForResuming,false);
 await act(async()=>a.options.onProgress(250_000_000,500_000_000));assert.equal(a.tree.root.findByType('progress').props.value,50);
 await act(async()=>a.button('Pause upload').props.onClick());assert.equal(a.aborts,1);assert.ok(a.button('Resume upload'));
 await act(async()=>a.button('Resume upload').props.onClick());assert.equal(a.starts,2);assert.equal(a.requests.length,1);
 await act(async()=>a.tree.unmount());assert.equal(a.aborts,2);assert.equal(a.busy.at(-1),null);
 await act(async()=>a.options.onError());assert.equal(a.complete,0);
});
test('retry failure leaves resumable state; cancellation failure cannot restart a cancelled callback generation',async()=>{
 const a=await setup({cancelError:true});await act(async()=>a.submit());
 await act(async()=>a.options.onError());assert.ok(a.button('Resume upload'));
 await act(async()=>a.button('Cancel upload').props.onClick());assert.ok(a.button('Close uploader'));assert.equal(a.button('Resume upload'),undefined);
 await act(async()=>a.options.onSuccess());assert.equal(a.requests.filter(r=>r.url?.endsWith('/complete')).length,0);assert.equal(a.complete,0);
 await act(async()=>a.tree.unmount());
});
test('uploaded bytes stay received on processing error; checking again does not create a second provider upload',async()=>{
 const a=await setup();await act(async()=>a.submit());await act(async()=>a.options.onSuccess());
 assert.ok(a.button('Check processing'));assert.equal(a.busy.at(-1),null);
 await act(async()=>a.button('Check processing').props.onClick());assert.equal(a.requests.filter(r=>r.url==='/api/admin/catalog-examples/upload').length,1);assert.equal(a.starts,1);
 await act(async()=>a.tree.unmount());
});
test('oversize and blank title fail before reservation; preparation failure unlocks the form',async()=>{
 const a=await setup({prepareError:true});await act(async()=>a.file(1_000_000_001));await act(async()=>a.submit());assert.equal(a.requests.length,0);
 await act(async()=>{a.file(500_000_000);a.title('   ')});await act(async()=>a.submit());assert.equal(a.requests.length,0);
 await act(async()=>a.title('Sample video'));await act(async()=>a.submit());assert.equal(a.starts,0);assert.ok(a.button('Upload video'));assert.equal(a.busy.at(-1),null);
 await act(async()=>a.tree.unmount());
});

test('auth outage and non-JSON response recover to ready without another preparation or transfer',async()=>{
 let checks=0;
 const a=await setup({completionReply:()=> ++checks===1
  ? Response.json({retryable:true,code:'authentication_unavailable'},{status:503})
  : checks===2?new Response('<html>Unavailable</html>'):Response.json({ok:true,status:'ready'})});
 await act(async()=>{a.submit();a.submit()});
 await act(async()=>{a.options.onSuccess();a.options.onSuccess()});
 assert.equal(checks,3);assert.equal(a.complete,1);assert.equal(a.starts,1);
 assert.equal(a.requests.filter(r=>r.url==='/api/admin/catalog-examples/upload').length,1);
 await act(async()=>{a.options.onError();a.options.onSuccess();a.options.onProgress(1,2)});
 assert.equal(a.button('Resume upload'),undefined);assert.equal(a.button('Cancel upload'),undefined);
 assert.equal(a.complete,1);assert.equal(a.tree.root.findByType('progress').props.value,100);
 await act(async()=>a.tree.unmount());
});

test('verification pending is a status notice, repeated check clicks share one run, and close never deletes',async()=>{
 let resolveCheck,checking=false;
 const a=await setup({completionReply:()=> checking?new Promise(r=>{resolveCheck=r}):Response.json({retryable:true},{status:503})});
 await act(async()=>a.submit());await act(async()=>a.options.onSuccess());
 assert.equal(a.tree.root.findAll(n=>n.props.role==='alert').length,0);
 assert.match(a.tree.root.findByProps({role:'status'}).children.join(''),/verification is still pending/);
 assert.equal(a.button('Cancel upload'),undefined);
 checking=true;const check=a.button('Check processing').props.onClick;
 await act(async()=>{check();check()});
 const checks=a.requests.filter(r=>r.url?.endsWith('/complete'));
 assert.equal(checks.length,4);
 const close=a.button('Close uploader').props.onClick;
 await act(async()=>{close();close()});
 assert.equal(checks.at(-1).init.signal.aborted,true);assert.equal(a.complete,1);
 await act(async()=>resolveCheck(Response.json({ok:true,status:'ready'})));
 assert.equal(a.complete,1);assert.equal(a.starts,1);assert.equal(a.requests.some(r=>r.cancel),false);
 await act(async()=>a.tree.unmount());
});

test('permission denial stops checks; refresh/back unmount prevents stale completion callbacks',async()=>{
 const denied=await setup({completionReply:()=>Response.json({retryable:true},{status:403})});
 await act(async()=>denied.submit());await act(async()=>denied.options.onSuccess());
 assert.equal(denied.requests.filter(r=>r.url?.endsWith('/complete')).length,1);
 assert.match(denied.tree.root.findByProps({role:'alert'}).children.join(''),/permission/);
 assert.equal(denied.button('Check processing'),undefined);assert.equal(denied.button('Resume upload'),undefined);
 await act(async()=>denied.tree.unmount());
 let resolveCheck;
 const a=await setup({completionReply:()=>new Promise(r=>{resolveCheck=r})});
 await act(async()=>a.submit());await act(async()=>a.options.onSuccess());
 const request=a.requests.at(-1);await act(async()=>a.tree.unmount());
 assert.equal(request.init.signal.aborted,true);
 await act(async()=>resolveCheck(Response.json({ok:true,status:'ready'})));
 assert.equal(a.complete,0);assert.equal(a.starts,1);assert.equal(a.requests.some(r=>r.cancel),false);
});
