// Compiled production Next boundary, no secrets/providers, feature disabled.
import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),out=process.env.PF_EVIDENCE_DIR;
assert.ok(out,'PF_EVIDENCE_DIR required');const buildId=(await readFile('.next/BUILD_ID','utf8')).trim();
const port=18964,origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port),'-H','127.0.0.1'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
try{
 let ready=false;for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error('server exited');try{const r=await fetch(origin+'/api/health');if(r.status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'server health readiness');
 const path='/api/photo-finals/21111111-1111-4111-8111-111111111101/resume';const results=[];
 for(const method of ['GET','POST']){const r=await fetch(origin+path,{method,headers:method==='POST'?{origin,'content-type':'application/json'}:{},body:method==='POST'?JSON.stringify({op:'begin',packageType:'originals'}):undefined,redirect:'manual'});const body=await r.text();assert.equal(r.status,503,body);assert.deepEqual(JSON.parse(body),{status:'disabled'});assert.match(r.headers.get('cache-control'),/no-store/);results.push({method,status:r.status,body});}
 await writeFile(out+'/compiled-route.json',JSON.stringify({passed:true,buildId,tier:'actual next build/start, unconfigured provider, code-dark GET/POST; enabled authenticated hosted gate NOT claimed',results},null,2));console.log('Compiled Next disabled route GET/POST passed');
}finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await writeFile(out+'/compiled-next-server.log',output);}
