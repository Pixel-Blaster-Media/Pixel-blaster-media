// Production-built Next + real auth/transport code; explicitly synthetic provider responses.
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import http from 'node:http';
import {makeChunkIndex} from '../lib/media/finals/chunk-index.ts';
const require=createRequire(import.meta.url),out=process.env.PF_EVIDENCE_DIR;assert(out);
const uid=n=>`${n}1111111-1111-4111-8111-111111111111`,host='zzzzzzzzzzzzzzzzzzzz.supabase.co';
const scope={organizationId:uid(1),bookingId:uid(3),propertyId:uid(4)},sessionId=uid(8),user={id:uid(2),aud:'authenticated',role:'authenticated',email:'compiled@example.invalid',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600;
const token=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:user.id,aud:'authenticated',role:'authenticated',session_id:sessionId,exp,iat:exp-3600})+'.synthetic-not-a-real-signature';
const index=makeChunkIndex({organization_id:scope.organizationId,package_id:uid(5),release_id:uid(6),manifest_sha256:'b'.repeat(64)},{bytes:5,sha256:'c'.repeat(64),digests:'d'.repeat(64)});
const state={transfer:{id:uid(7),expires_at:new Date(Date.now()+60000).toISOString()},index,coverage:[],package:{}};
const cookie='sb-zzzzzzzzzzzzzzzzzzzz-auth-token=base64-'+b64({access_token:token,refresh_token:'synthetic-only',expires_at:exp,expires_in:3600,token_type:'bearer',user});
const port=18965,origin=`http://127.0.0.1:${port}`;
const env={VERCEL_ENV:'production',PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'https://'+host,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_RESUMABLE_ENABLED:'1',PHOTO_FINALS_ENVIRONMENT:'production',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope]),PHOTO_FINALS_PRODUCTION_ACK:'private-resources-schema-runtime-certified-v1',PHOTO_FINALS_R2_ACCOUNT_ID:'0'.repeat(32),PHOTO_FINALS_R2_ACCESS_KEY_ID:'0'.repeat(32),PHOTO_FINALS_R2_SECRET_ACCESS_KEY:'0'.repeat(64),PHOTO_FINALS_R2_BUCKET:'local-fixture-private',PHOTO_FINALS_PRIVATE_BUCKET_ALLOWLIST:'["local-fixture-private"]',PF_COMPILED_FIXTURE:JSON.stringify({host,token,user,scope,state})};
const child=spawn(process.execPath,['--import',new URL('../tests/helpers/resume-compiled-provider-double.mjs',import.meta.url).pathname,require.resolve('next/dist/bin/next'),'start','-p',String(port),'-H','127.0.0.1'],{env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
try{
 let ready=false;for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error('server exited');try{if((await fetch(origin+'/api/health',{redirect:'manual'})).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);
 const path='/api/photo-finals/'+scope.bookingId+'/resume';const results=[];
 const request=async(label,url,init,status)=>{console.log('Probe:',label);const r=await new Promise((resolve,reject)=>{const req=http.request(origin+url,{method:init.method??'GET',headers:{host:'pixelblastermedia.com',...init.headers,...(init.headers?.origin===origin?{origin:`http://localhost:${port}`}:{}),...(init.body?{'content-length':Buffer.byteLength(init.body)}:{})}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(init.body);});const text=r.text;assert.equal(r.status,status,label+': '+text);assert(!text.includes('SENTINEL'));assert.match(r.headers['cache-control'],/no-store/);const body=JSON.parse(text);results.push({label,status,body});return body;};
 await request('anonymous denied',path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({op:'begin',packageId:uid(5)})},401);
 const session=await request('verified exact-token session','/api/photo-finals/session',{headers:{cookie}},200);assert.equal(session.identity,createHash('sha256').update(user.id+':'+sessionId).digest('hex'));
 const body=await request('authenticated indexed begin',path,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({op:'begin',packageId:uid(5)})},200);assert.equal(body.transferId,uid(7));
 await request('cross-origin denied',path,{method:'POST',headers:{cookie,origin:'https://foreign.invalid','content-type':'application/json'},body:JSON.stringify({op:'begin',packageId:uid(5)})},403);
 const budget=await request('authenticated exhausted budget',path+'?transferId='+uid(7)+'&index=0',{headers:{cookie}},429);assert.equal(budget.status,'budget-exhausted');
 await writeFile(out+'/compiled-enabled.json',JSON.stringify({passed:true,buildId:(await readFile('.next/BUILD_ID','utf8')).trim(),tier:'real compiled Next/auth/production RPC transport; auth and RPC provider doubles; no provider R2/hosted certification',results},null,2));console.log('Compiled enabled auth, begin, CSRF, typed budget passed');
}finally{child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));await writeFile(out+'/compiled-enabled-server.log',output);}
