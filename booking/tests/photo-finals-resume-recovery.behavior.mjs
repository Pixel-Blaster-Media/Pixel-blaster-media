import test from 'node:test';
import assert from 'node:assert/strict';

test('runtime recovery never exposes raw errors and distinguishes quota/private storage', async()=>{
 const mod=await import('../lib/media/resumable/recovery.ts').catch(()=>({}));
 assert.equal(typeof mod.recoveryProgress,'function','runtime recovery classifier missing');
 assert.equal(mod.recoveryProgress(new DOMException('SECRET','QuotaExceededError')).state,'quota');
 assert.equal(mod.recoveryProgress(new DOMException('SECRET','SecurityError')).state,'unsupported');
 for(const e of [Error('SECRET'),new DOMException('SECRET','NotAllowedError'),{message:'SECRET'}])assert(!JSON.stringify(mod.recoveryProgress(e)).includes('SECRET'));
 assert.match(mod.recoveryProgress(Error('SECRET')).error,/Retry/);
});

test('typed budget response stops chunk retries with a closed support state',async()=>{
 const {fetchChunk}=await import('../lib/media/resumable/network.ts');
 const {recoveryProgress}=await import('../lib/media/resumable/recovery.ts');
 let calls=0;
 await assert.rejects(()=>fetchChunk('/resume',new AbortController().signal,{fetch:async()=>{calls++;return Response.json({status:'budget-exhausted',recovery:'contact-support',error:'SECRET'},{status:429});},delay:async()=>assert.fail('budget must not retry')}),e=>{assert.equal(recoveryProgress(e).state,'budget-exhausted');assert(!JSON.stringify(recoveryProgress(e)).includes('SECRET'));return true;});
 assert.equal(calls,1);
});

test('controller suppresses raw runtime storage errors after authorized metadata', async()=>{
 const {DownloadController}=await import('../lib/media/resumable/controller.ts');
 const original={document:globalThis.document,Worker:globalThis.Worker,localStorage:globalThis.localStorage};
 const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.document={addEventListener(){},removeEventListener(){}};
 globalThis.Worker=class {};
 globalThis.localStorage={getItem(){throw new DOMException('SECRET runtime detail','QuotaExceededError');}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{},storage:{getDirectory(){},estimate(){}}}});
 const events=[];
 const c=new DownloadController({endpoint:'/resume',identity:'session',packageType:'originals',report:p=>events.push(p)});
 try{await c.start();assert.equal(events.at(-1).state,'quota');assert(!JSON.stringify(events).includes('SECRET'));}
 finally{c.dispose();Object.assign(globalThis,original);Object.defineProperty(globalThis,'navigator',nav);}
});
