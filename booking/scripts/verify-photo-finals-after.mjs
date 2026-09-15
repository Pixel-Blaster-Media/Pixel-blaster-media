// Built Next oracle; synthetic authorization/database seams, actual HTTP handler
// and actual after(). Never contacts a provider or substitutes for SQL fencing QA.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
const root=await mkdtemp(tmpdir()+'/pf-after-'),next=resolve('node_modules/next/dist/bin/next');
const pg=!!process.env.PF_TEST_SOCKET;
const env={...(pg?{PF_TEST_SOCKET:process.env.PF_TEST_SOCKET,PF_TEST_PSQL:process.env.PF_TEST_PSQL,PF_TEST_POSTGREST:process.env.PF_TEST_POSTGREST,PF_TEST_JWT:process.env.PF_TEST_JWT}:{}),PATH:process.env.PATH,HOME:process.env.HOME,NEXT_TELEMETRY_DISABLED:'1',NODE_ENV:'production'};
let child,log='';
const run=async(args)=>{const p=spawn(process.execPath,[next,...args],{cwd:root,env,stdio:['ignore','pipe','pipe']});p.stdout.on('data',b=>log+=b);p.stderr.on('data',b=>log+=b);assert.equal(await new Promise(r=>p.on('exit',r)),0,log);};
try{
 await mkdir(root+'/app/api/work',{recursive:true});await symlink(resolve('node_modules'),root+'/node_modules');
 await writeFile(root+'/package.json',JSON.stringify({private:true,dependencies:{next:'*',react:'*','react-dom':'*'}}));
 await writeFile(root+'/next.config.mjs','export default {experimental:{externalDir:true},typescript:{ignoreBuildErrors:true}}');
 await writeFile(root+'/app/layout.jsx','export default function Layout({children}){return <html><body>{children}</body></html>}');
 await writeFile(root+'/app/api/work/route.js',`import {after} from 'next/server';
import {createFinalsHandler} from ${JSON.stringify(resolve('lib/media/finals/http.ts'))};
import {fixture,identity,scope} from ${JSON.stringify(resolve(pg?'tests/helpers/photo-finals-operator-pg.mjs':'tests/helpers/photo-finals-operator-fixture.mjs'))};
export const dynamic='force-dynamic';export const runtime='nodejs';export const maxDuration=300;
let setup;let executed=0,scheduled=0;
async function initialize(){if(!setup)setup=(async()=>{const f=await fixture();
const rpc=f.runtime.db.rpc;
f.runtime.db.rpc=async(...args)=>{if(args[0]==='photo_finals_package_due'){await new Promise(r=>setTimeout(r,1500));executed++;}return rpc(...args);};
f.deps.authorize=async r=>r.headers.get('x-fixture-auth')==='operator'?identity:null;
f.deps.schedule=fn=>{after(fn);scheduled++;};
return {handler:createFinalsHandler(f.deps),metrics:f.metrics,abandon:f.abandon};})();return setup;}
export const POST=async r=>{const f=await initialize();return new URL(r.url).searchParams.has('abandon')?Response.json(f.abandon()):f.handler(r,scope.bookingId);};
export const GET=async r=>{const f=await initialize();return Response.json(new URL(r.url).searchParams.has('metrics')?f.metrics():{executed,scheduled});};`);
 await run(['build','--webpack']);assert.ok((await readFile(root+'/.next/BUILD_ID','utf8')).trim());
 const {createServer}=await import('node:net');const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 child=spawn(process.execPath,[next,'start','-H','127.0.0.1','-p',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});let startup='';child.stdout.on('data',b=>{log+=b;startup+=b;});child.stderr.on('data',b=>log+=b);
 const origin=await new Promise((yes,no)=>{const timer=setInterval(()=>{const m=startup.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearInterval(timer);clearTimeout(deadline);yes(m[0].replace('127.0.0.1','localhost'));}},25);const deadline=setTimeout(()=>{clearInterval(timer);no(Error(log));},20000);});
 for(let i=0;;i++){try{if((await fetch(origin+'/api/work')).ok)break;}catch{}if(i>100)throw Error('startup');await new Promise(r=>setTimeout(r,50));}
 const post=auth=>fetch(origin+'/api/work',{method:'POST',headers:{origin,'content-type':'application/json',...(auth?{'x-fixture-auth':'operator'}:{})},body:JSON.stringify({op:'work'})});
 assert.equal((await post(false)).status,401);assert.deepEqual(await (await fetch(origin+'/api/work')).json(),{executed:0,scheduled:0});
 let abandonment;
 if(pg){
  abandonment=await (await fetch(origin+'/api/work?abandon',{method:'POST'})).json();assert.deepEqual(abandonment,{killedAfterClaim:true,expiryAccelerated:true});
  // Deliberately discard the complete response: the caller has no accepted
  // receipt, but the registered invocation work must still converge on replay.
  const lost=await post(true);await lost.body.cancel();
 }
 const started=performance.now(),response=await post(true),elapsed=performance.now()-started;
 assert.equal(response.status,202,'built handler must return 202');assert.deepEqual(await response.json(),{status:'packaging'});assert.ok(elapsed<1000,'202 must precede delayed work: '+elapsed);
 assert.equal((await (await fetch(origin+'/api/work')).json()).executed,0);
 await new Promise(r=>setTimeout(r,2500));assert.deepEqual(await (await fetch(origin+'/api/work')).json(),{executed:pg?2:1,scheduled:pg?2:1});
 let publication;
 if(pg){publication=await (await fetch(origin+'/api/work?metrics')).json();assert.deepEqual(publication,{ready:1,packages:2,attempts:2,jobs:1});}
 console.log(JSON.stringify({builtNext:true,actualAfter:true,delayedDueMs:1500,responseMs:elapsed,denialSchedulesNothing:true,callbackExecuted:true,...(pg?{realPostgres:true,realPostgrestStatus:true,discardedResponseReplay:true,abandonment,publication}:{})}));
}finally{if(child){child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}if(process.env.PF_AFTER_LOG)await writeFile(process.env.PF_AFTER_LOG,log);await rm(root,{recursive:true,force:true});}
