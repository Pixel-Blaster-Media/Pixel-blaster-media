import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import WorkspaceModule from '../components/media/PhotoFinalsWorkspace.tsx';
const Workspace=WorkspaceModule.default??WorkspaceModule;
globalThis.React=React;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const snapshot=(key='owner:a')=>({status:'enabled',recoveryKey:key,batchId:null,revision:1,release:{id:'release',state:'packaging',revision:1},versions:[],gallery:null,packageJob:{status:'running'}});
test('real workspace polls and booking switch/unmount fences delayed reads',async t=>{
 const original={fetch:globalThis.fetch,document:globalThis.document,window:globalThis.window};
 globalThis.document=new EventTarget();document.hidden=false;globalThis.window=new EventTarget();
 t.mock.timers.enable({apis:['setTimeout']});let view,calls=[],release;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});if(calls.length===2)await new Promise(r=>release=r);return Response.json(snapshot(url.includes('/B')?'owner:b':'owner:a'));};
 try{
  await act(async()=>{view=Renderer.create(React.createElement(Workspace,{bookingId:'A',operator:true}));});assert.equal(calls.length,1);
  await act(async()=>{t.mock.timers.tick(2000);});assert.equal(calls.length,2,'automatic packaging poll');
  await act(async()=>{view.update(React.createElement(Workspace,{bookingId:'B',operator:true}));});assert.equal(calls[1].options.signal.aborted,true);assert.equal(calls.length,3);
  await act(async()=>{release();});assert.ok(calls[2].url.endsWith('/B'));assert.ok(calls.every(c=>!c.options.method));
  await act(async()=>{view.unmount();});await act(async()=>{t.mock.timers.tick(30000);});assert.equal(calls.length,3);
 }finally{if(view)await act(async()=>view.unmount());t.mock.timers.reset();Object.assign(globalThis,original);}
});

test('real workspace stops terminal polling and drops selection on changed identity',async t=>{
 const original={fetch:globalThis.fetch,document:globalThis.document,window:globalThis.window};
 globalThis.document=new EventTarget();document.hidden=false;globalThis.window=new EventTarget();
 t.mock.timers.enable({apis:['setTimeout']});let view,reads=0;
 globalThis.fetch=async()=>{reads++;const value=snapshot(reads===1?'owner:a':'owner:b');value.versions=[{id:'version',status:'accepted',previewUrl:null}];if(reads>1)value.packageJob={status:'needs_attention'};return Response.json(value);};
 try{
  await act(async()=>{view=Renderer.create(React.createElement(Workspace,{bookingId:'A',operator:true}));});
  const checkbox=()=>view.root.findByProps({'aria-label':'Select photo 1'});
  await act(async()=>checkbox().props.onChange());assert.equal(checkbox().props.checked,true);
  await act(async()=>{t.mock.timers.tick(2000);});assert.equal(reads,2);assert.equal(checkbox().props.checked,false);
  assert.ok(JSON.stringify(view.toJSON()).includes('needs operator attention'));
  assert.ok(!JSON.stringify(view.toJSON()).includes('Prepare private packages'));
  await act(async()=>{t.mock.timers.tick(30000);});assert.equal(reads,2);
 }finally{if(view)await act(async()=>view.unmount());t.mock.timers.reset();Object.assign(globalThis,original);}
});

test('manual refresh joins a poll instead of overlapping or stopping observation',async t=>{
 const original={fetch:globalThis.fetch,document:globalThis.document,window:globalThis.window};
 globalThis.document=new EventTarget();document.hidden=false;globalThis.window=new EventTarget();
 t.mock.timers.enable({apis:['setTimeout']});let view,reads=0,release;
 globalThis.fetch=async()=>{reads++;if(reads===2)await new Promise(r=>release=r);return Response.json(snapshot());};
 try{
  await act(async()=>{view=Renderer.create(React.createElement(Workspace,{bookingId:'A',operator:true}));});
  await act(async()=>{t.mock.timers.tick(2000);});assert.equal(reads,2);
  const button=view.root.findAllByType('button').find(b=>b.children.includes('Refresh photo status'));
  await act(async()=>button.props.onClick());assert.equal(reads,2,'manual read must wait for active poll');
  await act(async()=>release());assert.equal(reads,3);
  await act(async()=>{t.mock.timers.tick(3000);});assert.equal(reads,4,'polling continues after joined manual read');
 }finally{if(view)await act(async()=>view.unmount());t.mock.timers.reset();Object.assign(globalThis,original);}
});

test('explicit accepted retry starts a new finite observation session',async t=>{
 const original={fetch:globalThis.fetch,document:globalThis.document,window:globalThis.window};
 globalThis.document=new EventTarget();document.hidden=false;globalThis.window=new EventTarget();
 t.mock.timers.enable({apis:['setTimeout']});let view,reads=0;
 globalThis.fetch=async(url,options)=>{if(options.method==='POST')return Response.json({status:'packaging'},{status:202});reads++;return Response.json(snapshot());};
 try{
  await act(async()=>{view=Renderer.create(React.createElement(Workspace,{bookingId:'A',operator:true}));});
  await act(async()=>{t.mock.timers.tick(300000);});const before=reads;
  const button=view.root.findAllByType('button').find(b=>b.children.includes('Prepare private packages'));
  await act(async()=>button.props.onClick());await act(async()=>{t.mock.timers.tick(2000);});assert.equal(reads,before+1);
 }finally{if(view)await act(async()=>view.unmount());t.mock.timers.reset();Object.assign(globalThis,original);}
});

test('Edits folder previews the names, stages only its JPEGs and never approves or sends', async () => {
 const original={fetch:globalThis.fetch,document:globalThis.document,window:globalThis.window};
 const locks=Object.getOwnPropertyDescriptor(navigator,'locks');
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name,fn)=>fn()}});
 globalThis.document=new EventTarget();document.hidden=false;globalThis.window=new EventTarget();
 const existing={id:'previous',status:'accepted',previewUrl:null}, uploads=[], operations=[];
 let view;
 globalThis.fetch=async(url,options)=>{
  if(options.method!=='POST'){
   const result=snapshot();result.release=null;result.versions=[existing,...uploads.map(id=>({id,status:'accepted',previewUrl:null}))];
   return Response.json(result);
  }
  const request=JSON.parse(options.body);operations.push(request.op);
  assert.equal(request.op,'intent');assert.equal(url,'/api/photo-finals/A');
  uploads.push('new-'+uploads.length);
  return Response.json({status:'accepted',versionId:uploads.at(-1)});
 };
 function file(name, body, relativePath='Edits/'+name){
  return Object.assign(new File([body],name,{type:'image/jpeg'}),{webkitRelativePath:relativePath});
 }
 try{
  await act(async()=>{view=Renderer.create(React.createElement(Workspace,{bookingId:'A',operator:true}));});
  const input=view.root.findByProps({'aria-label':'Choose Edits folder'});
  await act(async()=>input.props.onChange({target:{files:[file('10.jpg','10'),file('2.jpg','2'),file('1.jpg','nested','Edits/RAW/1.jpg')]}}));
  assert.deepEqual(view.root.findAllByType('li').filter(n=>typeof n.children[0]==='string').map(n=>n.children[0]),['2.jpg','10.jpg']);
  assert.deepEqual(operations,[]);
  const stage=view.root.findAllByType('button').find(b=>b.children.includes('Stage folder JPEGs for review'));
  await act(async()=>await stage.props.onClick());
  assert.deepEqual(operations,['intent','intent']);
  assert.equal(view.root.findByProps({'aria-label':'Select photo 1'}).props.checked,false);
  assert.equal(view.root.findByProps({'aria-label':'Select photo 2'}).props.checked,true);
  assert.equal(view.root.findByProps({'aria-label':'Select photo 3'}).props.checked,true);
  assert.ok(JSON.stringify(view.toJSON()).includes('Nothing was approved or sent'));
 }finally{
  if(view) await act(async()=>view.unmount());
  if(locks) Object.defineProperty(navigator,'locks',locks); else delete navigator.locks;
  Object.assign(globalThis,original);
 }
});
