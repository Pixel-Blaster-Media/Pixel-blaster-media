import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {create,act} from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.React=React;
test('workspace only replaces indexed Pixel anchors and preserves iGUIDE precedence',async()=>{
 const loaded=await import('../components/media/PhotoFinalsWorkspace.tsx');const Workspace=loaded.default?.default??loaded.default;
 const original={fetch:globalThis.fetch,document:globalThis.document,window:globalThis.window};globalThis.document=new EventTarget();document.hidden=false;globalThis.window=new EventTarget();
 try{for(const mode of ['disabled','indexed','iguide']){let view;
 const d={category:'photos',source:'pixel_release',slot:'photos_full_res',label:'Full-resolution ZIP',url:'/api/photo-finals/A?download=package'};
 globalThis.fetch=async()=>Response.json({status:'enabled',recoveryKey:null,versions:[],release:null,gallery:{releaseId:'release',items:[],downloads:[d]},...(mode==='disabled'?{}:{resumable:{identity:'actor',packageIds:['package']}})});
 try{await act(async()=>{view=create(React.createElement(Workspace,{bookingId:'A',incumbent:mode==='iguide'?[{...d,source:'iguide',url:'/iguide',label:'iGUIDE'}]:[]}));});
 const prepare=view.root.findAllByType('button').filter(b=>b.children.includes('Prepare ZIP'));assert.equal(prepare.length,mode==='indexed'?1:0,mode);
 if(mode!=='indexed')assert.ok(view.root.findAllByType('a').some(a=>a.props.href===(mode==='iguide'?'/iguide':d.url)));
 }finally{if(view)await act(async()=>view.unmount());}}
 }finally{Object.assign(globalThis,original);}
});
test('budget-exhausted control offers support, not another charged retry',async()=>{
 const {DownloadController}=await import('../lib/media/resumable/controller.ts');const originalStart=DownloadController.prototype.start;
 const original=globalThis.document;globalThis.document={addEventListener(){},removeEventListener(){}};
 DownloadController.prototype.start=async function(){this.options.report({state:'budget-exhausted',bytes:0,error:'Contact support. New transfers cannot reset the limit.'});};
 const m=await import('../components/media/ResumableDownload.tsx');let view;
 try{await act(async()=>{view=create(React.createElement(m.default,{endpoint:'/resume',identity:'actor',packageId:'x',packageType:'originals',label:'ZIP'}));});await act(async()=>view.root.findAllByType('button')[0].props.onClick());
 assert.equal(view.root.findAllByType('button').filter(b=>JSON.stringify(b.children).includes('Resume')).length,0);assert.ok(view.root.findAllByType('a').some(a=>a.props.href==='mailto:info@pixelblastermedia.com'));
 }finally{if(view)await act(async()=>view.unmount());DownloadController.prototype.start=originalStart;globalThis.document=original;}
});

test('disabled global boundary checks orphan OPFS even without a journal',async()=>{
 const mod=await import('../app/DownloadSessionBoundary.tsx');
 const old={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage};const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');let reads=0;
 globalThis.document=new EventTarget();globalThis.window=new EventTarget();const stored=new Map();globalThis.localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name,options,callback)=>(callback??options)()},storage:{getDirectory:async()=>{reads++;return {async *keys(){}};}}}});
 let view;try{await act(async()=>{view=create(React.createElement(mod.default,{enabled:false}));await new Promise(r=>setTimeout(r,0));});assert(reads>0,'missing journals do not prove missing retained files');}
 finally{if(view)await act(async()=>view.unmount());Object.assign(globalThis,old);Object.defineProperty(globalThis,'navigator',nav);}
});

test('resumable control starts explicitly and labels Save as initiation not receipt',async()=>{
 const m=await import('../components/media/ResumableDownload.tsx').catch(()=>({}));assert.equal(typeof m.default,'function','download control missing');
 const original=globalThis.document;globalThis.document={addEventListener(){},removeEventListener(){}};
 let view;try{await act(async()=>{view=create(React.createElement(m.default,{endpoint:'/resume',identity:'actor',packageId:'x',packageType:'originals',label:'Full-resolution ZIP'}));});
 assert.ok(view.root.findAllByType('button').some(b=>b.children.includes('Prepare ZIP')));assert.match(JSON.stringify(view.toJSON()),/temporary storage/);assert.equal(view.root.findAllByType('a').length,0);
 await act(async()=>view.unmount());}finally{globalThis.document=original;}
});
