import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import Renderer,{act} from 'react-test-renderer';
import {loadSource} from './helpers/source-module.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const policy=loadSource('lib/booking/catalog-upload-policy.ts');
const transport=loadSource('lib/booking/catalog-upload-transport.ts');
async function setup({prepareError=false,cancelError=false}={}){
 const requests=[],busy=[];let options,starts=0,aborts=0,complete=0;
 const Uploader=loadSource('app/admin/settings/pricing/CatalogVideoUploader.tsx',{
  react:React,'react/jsx-runtime':jsxRuntime,
  '@/lib/booking/catalog-upload-policy':{...policy,catalogFileFingerprint:async()=> 'a'.repeat(64)},
  '@/lib/booking/catalog-upload-transport':transport,
  './example-actions':{deleteCatalogExample:async id=>{requests.push({cancel:id});return cancelError?{ok:false,error:'Mock cancellation failed'}:{ok:true};}},
 },{AbortSignal,crypto,setTimeout,XMLHttpRequest:undefined,
  fetch:async(url,init)=>{requests.push({url,init});if(url.endsWith('/complete'))return Response.json({error:'Mock check unavailable'},{status:503});
   if(prepareError)return Response.json({error:'Mock preparation rejected'},{status:503});
   return Response.json({exampleId:'owned-example',uploadUrl:'https://upload.videodelivery.net/mock',expiresAt:new Date(Date.now()+3600_000).toISOString(),resumed:false});},
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
