import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const uid = n => `${n}1111111-1111-4111-8111-111111111111`;
const origin = 'https://booking.example';
const request = (overrides={}) => new Request(origin+'/api/photo-finals/operator-smoke', {method:'POST',headers:{origin},...overrides});
function admitted() {
  const now = Date.now();
  const resource = {accountId:'a'.repeat(32), bucket:'private-smoke-existing', endpoint:`https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, privateAccess:'verified-private-no-public-domains', retentionUntil:new Date(now+86400000).toISOString(), allowance:'one-run-3-class-a-2-class-b-132096-upload-bytes'};
  const prefix = `operator-smoke/v1/${uid(1)}/${uid(3)}`;
  const admission = {version:'non-certifying-storage-smoke-v1', issuedAt:new Date(now-1000).toISOString(), expiresAt:new Date(now+60000).toISOString(), runId:uid(3), actorId:uid(2), organizationId:uid(1), origin, claimKey:prefix+'/claim.json', objectKey:prefix+'/payload.bin', resourceSha256:sha(JSON.stringify(resource))};
  const env = {PHOTO_FINALS_OPERATOR_SMOKE_ENABLED:'1',PHOTO_FINALS_SMOKE_ADMISSION:JSON.stringify(admission),PHOTO_FINALS_SMOKE_RESOURCE:JSON.stringify(resource),PHOTO_FINALS_SMOKE_R2_ACCESS_KEY_ID:'b'.repeat(32),PHOTO_FINALS_SMOKE_R2_SECRET_ACCESS_KEY:'c'.repeat(64)};
  return {env,admission,resource};
}
import {LocalS3} from './helpers/photo-finals-local-s3.mjs';
import {Readable} from 'node:stream';
class SmokeS3 extends LocalS3 {
  calls=[];
  async send(command, options={}) {
    options.abortSignal?.throwIfAborted();
    this.calls.push({name:command.constructor.name,input:command.input});
    try {
      const result=await super.send(command);
      if(command.constructor.name==='GetObjectCommand') {
        assert.equal(command.input.Range,'bytes=1024-2047');
        result.Body.destroy();
        const bytes=this.objects.get(command.input.Bucket+'/'+command.input.Key).bytes.subarray(1024,2048);
        return {...result,Body:Readable.from([bytes]),ContentLength:1024,ContentRange:'bytes 1024-2047/65536',$metadata:{httpStatusCode:206}};
      }
      return {...result,$metadata:{httpStatusCode:200}};
    } catch(e) {if(e.name==='PreconditionFailed')e.$metadata={httpStatusCode:412}; throw e;}
  }
}

test('one fixed protocol consumes claim and replay cannot repeat payload', async(t)=>{
  const {createOperatorSmokeHandler}=await implementation();
  const f=admitted(), store=new SmokeS3();
  const make=()=>createOperatorSmokeHandler({env:f.env,authorize:async()=>actor,storage:()=>store});
  const response=await make()(request());
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.status,'verified-storage-smoke');
  assert.equal(result.certified,false);
  assert.equal(result.payloadBytes,65536);
  assert.equal(result.rangeBytes,1024);
  assert.equal(result.operations,5);
  assert.deepEqual(store.calls.map(c=>c.name),['PutObjectCommand','PutObjectCommand','PutObjectCommand','HeadObjectCommand','GetObjectCommand']);
  assert.deepEqual(store.calls.map(c=>c.input.Key),[f.admission.claimKey,f.admission.objectKey,f.admission.objectKey,f.admission.objectKey,f.admission.objectKey]);
  for(const call of store.calls)assert.equal(call.input.Bucket,f.resource.bucket);
  for(const call of store.calls.slice(0,3)) {
    assert.equal(call.input.IfNoneMatch,'*');
    assert.equal(call.input.ContentLength,call.input.Body.length);
    assert.equal(call.input.Metadata.sha256,sha(call.input.Body));
  }
  assert.ok(store.calls[0].input.Body.length<=1024);
  assert.equal(result.uploadBytes,store.calls.slice(0,3).reduce((n,c)=>n+c.input.Body.length,0));
  assert.ok(result.uploadBytes<=132096);
  assert.equal(store.objects.size,2);
  assert.equal((await make()(request())).status,409);
  assert.equal(store.calls.length,6);
  assert.equal(store.puts,2);
  t.diagnostic(JSON.stringify({result,claimBytes:store.calls[0].input.Body.length,retainedBytes:[...store.objects.values()].reduce((n,o)=>n+o.bytes.length,0),payloadSha256:sha(store.calls[1].input.Body)}));
});
const actor = {actorId:uid(2),organizationId:uid(1),role:'admin',archivedAt:null,membershipRole:'admin'};

test('strict admission and wrong request fail before any auth/provider activity', async () => {
  const {createOperatorSmokeHandler} = await implementation();
  const cases = [
    f=>{f.admission.expiresAt=new Date(Date.now()-1).toISOString();},
    f=>{f.admission.issuedAt=new Date(Date.now()+1000).toISOString();},
    f=>{f.admission.expiresAt=new Date(Date.now()+3600000).toISOString();},
    f=>{f.admission.objectKey='customers/wrong';},
    f=>{f.admission.claimKey+='x';},
    f=>{f.admission.resourceSha256='0'.repeat(64);},
    f=>{f.resource.endpoint='https://evil.example';},
    f=>{f.resource.bucket='../bad';},
    f=>{f.resource.privateAccess='unknown';},
    f=>{f.resource.retentionUntil=new Date(Date.now()-1).toISOString();},
    f=>{f.resource.allowance='unlimited';},
    f=>{f.admission.size=131073;},
    f=>{f.env.PHOTO_FINALS_SMOKE_R2_ACCESS_KEY_ID='invalid';},
  ];
  for (const mutate of cases) {
    const f=admitted(); mutate(f);
    f.env.PHOTO_FINALS_SMOKE_ADMISSION=JSON.stringify(f.admission);
    f.env.PHOTO_FINALS_SMOKE_RESOURCE=JSON.stringify(f.resource);
    let calls=0;
    const h=createOperatorSmokeHandler({env:f.env,authorize(){calls++;throw Error('auth');},storage(){calls++;throw Error('storage');}});
    assert.equal((await h(request())).status,503);
    assert.equal(calls,0);
  }
  for (const req of [request({headers:{origin:'https://foreign.example'}}), request({headers:{}}), request({method:'GET'}), request({body:'{}'}), new Request(origin+'/api/photo-finals/operator-smoke?key=x',{method:'POST',headers:{origin}})]) {
    let calls=0;
    const h=createOperatorSmokeHandler({env:admitted().env,authorize(){calls++;throw Error('auth');},storage(){calls++;throw Error('storage');}});
    assert.equal((await h(req)).status,400);
    assert.equal(calls,0);
  }
});

test('only exact current admin tuple reaches storage admission', async () => {
  const {createOperatorSmokeHandler}=await implementation();
  for (const identity of [null,{...actor,actorId:uid(4)},{...actor,organizationId:uid(4)},{...actor,role:'realtor'},{...actor,archivedAt:'2026-01-01'},{...actor,membershipRole:'member'}]) {
    let auth=0,storage=0;
    const h=createOperatorSmokeHandler({env:admitted().env,authorize:async()=>{auth++;return identity;},storage(){storage++;throw Error('wrong actor storage');}});
    assert.equal((await h(request())).status,403);
    assert.equal(auth,1);
    assert.equal(storage,0);
  }
});

registerHooks({resolve(specifier, context, next) {
  if (specifier === '@/lib/supabase/server') return {url:'data:text/javascript,export async function getServerSupabase(){return globalThis.__smokeDb();}',shortCircuit:true};
  if (specifier.startsWith('@/')) return next(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  if (specifier === 'server-only') return {url:'data:text/javascript,export {};',shortCircuit:true};
  return next(specifier, context);
}});
const moduleUrl = new URL('../lib/media/finals/operator-smoke.ts', import.meta.url);
async function implementation() {
  assert.ok(existsSync(moduleUrl), 'operator smoke implementation must exist');
  return import(moduleUrl.href);
}

import {createServer, request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {PutObjectCommand} from '@aws-sdk/client-s3';
async function wireFixture(callback) {
  const store=new SmokeS3(), observed=[];
  const server=createServer(async(req,res)=>{
    observed.push({method:req.method,url:req.url,headers:req.headers});
    if(callback)return callback(req,res);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks), key=new URL(req.url,'http://local').pathname.slice(1);
    const {HeadObjectCommand,GetObjectCommand}=await import('@aws-sdk/client-s3');
    const command=new ({PUT:PutObjectCommand,HEAD:HeadObjectCommand,GET:GetObjectCommand}[req.method])({Bucket:'private-smoke-existing',Key:key,Body:body,ContentLength:body.length,ContentType:req.headers['content-type'],Metadata:{sha256:req.headers['x-amz-meta-sha256']},IfNoneMatch:req.headers['if-none-match'],IfMatch:req.headers['if-match'],Range:req.headers.range});
    try {
      const result=await store.send(command);
      res.writeHead(result.$metadata.httpStatusCode,{'content-type':result.ContentType??'application/octet-stream',etag:result.ETag,...(result.ContentLength!==undefined?{'content-length':result.ContentLength}:{}),...(result.Metadata?{'x-amz-meta-sha256':result.Metadata.sha256}:{}),...(result.ContentRange?{'content-range':result.ContentRange}:{})});
      if(result.Body)for await(const chunk of result.Body)res.write(chunk);
      res.end();
    } catch {res.writeHead(412,{'content-type':'application/xml'});res.end('<Error><Code>PreconditionFailed</Code></Error>');}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const transport=(options,cb)=>{
    assert.equal(options.hostname,'private-smoke-existing.'+'a'.repeat(32)+'.r2.cloudflarestorage.com');
    return httpRequest({...options,hostname:'127.0.0.1',port:server.address().port,protocol:'http:'},cb);
  };
  return {store,observed,transport,port:server.address().port,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}

test('real route is off before Supabase and verifies current session/profile/membership when armed',async()=>{
  const routeUrl=new URL('../app/api/photo-finals/operator-smoke/route.ts',import.meta.url);
  assert.ok(existsSync(routeUrl),'operator smoke route must exist');
  const route=await import(routeUrl.href);
  assert.equal(route.runtime,'nodejs');assert.equal(route.maxDuration,20);
  const f=admitted(),saved={};for(const k of Object.keys(f.env)){saved[k]=process.env[k];delete process.env[k];}
  let clients=0;const calls=[];
  globalThis.__smokeDb=()=>{clients++;return {auth:{
    async getSession(){calls.push('session');return {data:{session:{access_token:'header.'+Buffer.from(JSON.stringify({sub:uid(2),session_id:uid(8)})).toString('base64url')+'.signature'}},error:null};},
    async getUser(token){calls.push('verified-exact-token');assert.ok(token.startsWith('header.'));return {data:{user:{id:uid(2)}},error:null};}
  },from(table){calls.push(table);const q={select(){return q;},eq(k,v){calls.push([table,k,v]);return q;},in(k,v){calls.push([table,k,v]);return q;},abortSignal(s){assert.equal(s.aborted,false);return q;},async maybeSingle(){return {error:null,data:table==='profiles'?{id:uid(2),organization_id:uid(1),role:'admin',archived_at:null}:null};}};return q;}};};
  try {
    assert.equal((await route.POST(request())).status,404);assert.equal(clients,0);
    Object.assign(process.env,f.env);
    // Missing privileged membership denies before constructing any storage client.
    assert.equal((await route.POST(request())).status,403);
    assert.deepEqual(calls.filter(v=>typeof v==='string'),['session','verified-exact-token','profiles','organization_members']);
    assert.ok(calls.some(v=>JSON.stringify(v)===JSON.stringify(['organization_members','organization_id',uid(1)])));
    assert.ok(calls.some(v=>JSON.stringify(v)===JSON.stringify(['organization_members','profile_id',uid(2)])));
  } finally {for(const k of Object.keys(f.env))if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];delete globalThis.__smokeDb;}
});

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('separate Node instances racing the same local storage cannot replay a consumed run',async()=>{
  const wire=await wireFixture(), f=admitted();
  const source=`import {registerHooks} from 'node:module';import {request as httpRequest} from 'node:http';
    registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export {};',shortCircuit:true};return n(s,c);}});
    const m=await import(${JSON.stringify(moduleUrl.href)});
    const env=JSON.parse(process.argv[1]),port=Number(process.argv[2]);
    const transport=(o,cb)=>httpRequest({...o,hostname:'127.0.0.1',port,protocol:'http:'},cb);
    const h=m.createOperatorSmokeHandler({env,authorize:async()=>(${JSON.stringify(actor)}),storage:(c,e)=>m.createSmokeStorage(c,e,transport)});
    const r=await h(new Request(${JSON.stringify(origin+'/api/photo-finals/operator-smoke')},{method:'POST',headers:{origin:${JSON.stringify(origin)}}}));
    console.log(r.status);`;
  const run=async()=>Number((await promisify(execFile)(process.execPath,['--input-type=module','-e',source,JSON.stringify(f.env),String(wire.port)],{env:{PATH:process.env.PATH},timeout:10000,maxBuffer:8192})).stdout.trim());
  try {
    assert.deepEqual((await Promise.all([run(),run()])).sort(),[200,409]);
    assert.equal(await run(),409);
    assert.equal(wire.store.puts,2);
    assert.equal(wire.store.objects.size,2);
    assert.equal(wire.observed.length,7);
  } finally {await wire.close();}
});

test('ambiguous storage outcomes stop at that command and retain the consumed claim',async()=>{
  const {createOperatorSmokeHandler}=await implementation();
  for(const lostAt of [1,2,3,4,5]) {
    const f=admitted(), store=new SmokeS3();let count=0;
    const storage={async send(c,o){count++;let result;try{result=await store.send(c,o);}catch(e){if(count===lostAt)throw new Error('SECRET ambiguous');throw e;}if(count===lostAt)throw new Error('SECRET ambiguous');return result;}};
    const h=createOperatorSmokeHandler({env:f.env,authorize:async()=>actor,storage:()=>storage});
    const r=await h(request());assert.equal(r.status,503);assert.equal(count,lostAt);assert.equal((await r.text()).includes('SECRET'),false);
    const replay=createOperatorSmokeHandler({env:f.env,authorize:async()=>actor,storage:()=>store});
    assert.equal((await replay(request())).status,409);
    assert.ok(store.objects.has(f.resource.bucket+'/'+f.admission.claimKey));
  }
});

test('HEAD and Range require exact status, identity, length, hash and bounded actual bytes',async()=>{
  const {createOperatorSmokeHandler}=await implementation();
  const mutations=[
    ['HeadObjectCommand',r=>({...r,ContentLength:65537})],
    ['HeadObjectCommand',r=>({...r,Metadata:{sha256:'0'.repeat(64)}})],
    ['HeadObjectCommand',r=>({...r,ETag:'wrong'})],
    ['GetObjectCommand',r=>({...r,$metadata:{httpStatusCode:200}})],
    ['GetObjectCommand',r=>({...r,ContentRange:'bytes 0-1023/65536'})],
    ['GetObjectCommand',r=>({...r,ContentLength:1025})],
    ['GetObjectCommand',r=>({...r,Body:Readable.from([Buffer.alloc(1025)])})],
    ['GetObjectCommand',r=>({...r,Body:Readable.from([Buffer.alloc(1023)])})],
    ['GetObjectCommand',r=>({...r,Body:Readable.from([Buffer.alloc(1024)])})],
  ];
  for(const [name,mutate] of mutations){
    const f=admitted(),store=new SmokeS3();let body;
    const h=createOperatorSmokeHandler({env:f.env,authorize:async()=>actor,storage:()=>({async send(c,o){const r=await store.send(c,o);if(c.constructor.name!==name)return r;const changed=mutate(r);if(r.Body&&r.Body!==changed.Body)r.Body.destroy();body=changed.Body;return changed;}})});
    assert.equal((await h(request())).status,503);
    if(body)assert.equal(body.destroyed,true);
    assert.ok(store.calls.length<=5);
  }
});

test('native transport rejects redirects, declared/streamed overflow, header overflow, encoding and stalls without retry',async()=>{
  const mod=await implementation();
  const cases=[
    (_q,r)=>{r.writeHead(302,{location:'http://127.0.0.1:1/forbidden'});r.end();},
    (_q,r)=>{r.writeHead(200,{'content-length':'999999',etag:'x'});r.end();},
    (_q,r)=>{r.writeHead(200,{etag:'x'});r.end(Buffer.alloc(2049));},
    (_q,r)=>{r.writeHead(200,{'x-large':'x'.repeat(9000)});r.end();},
    (_q,r)=>{r.writeHead(200,{'content-encoding':'gzip',etag:'x'});r.end();},
    (_q,r)=>{r.writeHead(200,{etag:'x'});r.flushHeaders();},
  ];
  for(const callback of cases){
    const wire=await wireFixture(callback),f=admitted();
    try {
      const h=mod.createOperatorSmokeHandler({env:f.env,authorize:async()=>actor,storage:(c,e)=>mod.createSmokeStorage(c,e,wire.transport)});
      const r=await h(request(),Date.now()-14800);assert.equal(r.status,503);
      assert.equal(wire.observed.length,1);
    }finally{await wire.close();}
  }
});

import {mkdtemp, readFile, stat, rm, writeFile, chmod, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('driver seals a new protected journal before one local request and refuses reuse/remote default',async()=>{
  const driverUrl=new URL('../scripts/verify-photo-finals-operator-smoke.mjs',import.meta.url);
  assert.ok(existsSync(driverUrl),'operator smoke driver must exist');
  const {runOperatorSmoke}=await import(driverUrl.href);
  const directory=await realpath(await mkdtemp(join(tmpdir(),'smoke-driver-')));await chmod(directory,0o700);
  const journal=join(directory,'journal.jsonl');let received=0;
  const server=createServer(async(req,res)=>{
    received++;assert.equal(req.method,'POST');assert.equal(req.url,'/api/photo-finals/operator-smoke');
    assert.equal(req.headers.origin,`http://127.0.0.1:${server.address().port}`);
    assert.equal((await stat(journal)).mode&0o777,0o600);
    assert.match(await readFile(journal,'utf8'),/attempt-sealed/);
    res.writeHead(404,{'content-type':'application/json'});res.end('{"status":"disabled"}');
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const origin=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await runOperatorSmoke({origin,journal})).status,'disabled');assert.equal(received,1);
    await assert.rejects(runOperatorSmoke({origin,journal}));assert.equal(received,1);
    await assert.rejects(runOperatorSmoke({origin:'https://pixelblastermedia.com',journal:join(directory,'remote.jsonl')}));
    assert.equal(existsSync(join(directory,'remote.jsonl')),false);
    const record=await readFile(journal,'utf8');assert.equal(record.includes('cookie'),false);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
});

test('hosted driver requires a separate expiring ticket and protected session file; tests never dispatch hosted',async()=>{
  const driver=await import('../scripts/verify-photo-finals-operator-smoke.mjs');
  assert.equal(typeof driver.prepareHostedSmoke,'function');
  const directory=await realpath(await mkdtemp(join(tmpdir(),'smoke-ticket-')));await chmod(directory,0o700);
  const authorizationFile=join(directory,'authorization.json'),cookieFile=join(directory,'session.txt');
  const admission=admitted().admission;admission.origin='https://pixelblastermedia.com';
  const ticket={authorization:'separately-authorized-one-shot-hosted-smoke-v1',admission};
  try {
    await writeFile(authorizationFile,JSON.stringify(ticket),{mode:0o600});await writeFile(cookieFile,'local-fixture-session=not-a-real-session',{mode:0o600});
    const ready=await driver.prepareHostedSmoke({authorizationFile,cookieFile});
    assert.equal(ready.origin,admission.origin);assert.equal(ready.registration.runId,admission.runId);
    await chmod(cookieFile,0o644);await assert.rejects(driver.prepareHostedSmoke({authorizationFile,cookieFile}));await chmod(cookieFile,0o600);
    ticket.admission.expiresAt=new Date(Date.now()-1).toISOString();await writeFile(authorizationFile,JSON.stringify(ticket));
    await assert.rejects(driver.prepareHostedSmoke({authorizationFile,cookieFile}));
    await assert.rejects(driver.runOperatorSmoke({mode:'hosted',journal:join(directory,'denied.jsonl')}));
    assert.equal(existsSync(join(directory,'denied.jsonl')),false);
  } finally {await rm(directory,{recursive:true,force:true});}
});

import {NextRequestAdapter} from 'next/dist/server/web/spec-extension/adapters/next-request.js';
test('actual Next adapter empty POST stream is admitted without accepting any client bytes',async()=>{
  const {createOperatorSmokeHandler}=await implementation();
  const f=admitted(),store=new SmokeS3();let auth=0;
  const h=createOperatorSmokeHandler({env:f.env,authorize:async()=>{auth++;return actor;},storage:()=>store});
  const adapt=body=>NextRequestAdapter.fromNodeNextRequest({method:'POST',body:Readable.from(body),url:origin+'/api/photo-finals/operator-smoke',headers:{origin,'content-length':'0'}},new AbortController().signal);
  const empty=adapt([]);assert.notEqual(empty.body,null);
  assert.equal((await h(empty)).status,200);assert.equal(auth,1);
  assert.equal((await h(adapt([Buffer.from('x')]))).status,400);assert.equal(auth,1);
});

test('normal production ACK remains required with complete dummy config and smoke admission',async()=>{
  const {finalsExecutionAllowed}=await import('../lib/media/finals/production-config.ts');
  const scope={organizationId:uid(1),bookingId:uid(4),propertyId:uid(5)};
  const env={...admitted().env,PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'production',VERCEL_ENV:'production',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope]),PHOTO_FINALS_R2_ACCOUNT_ID:'a'.repeat(32),PHOTO_FINALS_R2_BUCKET:'private-finals-test',PHOTO_FINALS_PRIVATE_BUCKET_ALLOWLIST:'["private-finals-test"]',PHOTO_FINALS_R2_ACCESS_KEY_ID:'b'.repeat(32),PHOTO_FINALS_R2_SECRET_ACCESS_KEY:'c'.repeat(64),NEXT_PUBLIC_SUPABASE_URL:'https://'+'d'.repeat(20)+'.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'local-only-dummy'};
  assert.equal(finalsExecutionAllowed(env,scope),false);
  assert.equal(finalsExecutionAllowed({...env,PHOTO_FINALS_PRODUCTION_ACK:'non-certifying-storage-smoke-v1'},scope),false);
  assert.equal(finalsExecutionAllowed({...env,PHOTO_FINALS_PRODUCTION_ACK:'private-resources-schema-runtime-certified-v1'},scope),true);
});

test('driver ambiguity is journaled once, cannot retry or leak upstream data',async()=>{
  const {runOperatorSmoke}=await import('../scripts/verify-photo-finals-operator-smoke.mjs');
  const directory=await realpath(await mkdtemp(join(tmpdir(),'smoke-ambiguous-')));await chmod(directory,0o700);
  let calls=0;
  const server=createServer((_q,r)=>{calls++;r.writeHead(200,{'content-type':'application/json'});r.end('SECRET'+ 'x'.repeat(2049));});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const options={origin:`http://127.0.0.1:${server.address().port}`,journal:join(directory,'journal.jsonl')};
    await assert.rejects(runOperatorSmoke(options));assert.equal(calls,1);
    await assert.rejects(runOperatorSmoke(options));assert.equal(calls,1);
    const text=await readFile(options.journal,'utf8');assert.match(text,/STOP-unconfirmed-no-retry/);assert.equal(text.includes('SECRET'),false);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
});

test('native storage boundary refuses wrong key, bucket, size and nonenumerated commands before transport',async()=>{
  const mod=await implementation(),{DeleteObjectCommand,ListObjectsV2Command}=await import('@aws-sdk/client-s3');
  const f=admitted(),config=mod.loadSmokeAdmission(f.env);let calls=0;
  const input={Bucket:config.bucket,Key:config.claimKey,Body:Buffer.from('claim'),ContentLength:5,IfNoneMatch:'*'};
  const commands=[new PutObjectCommand({...input,Key:'customer/key'}),new PutObjectCommand({...input,Bucket:'other-bucket'}),new PutObjectCommand({...input,Body:Buffer.alloc(1025),ContentLength:1025}),new DeleteObjectCommand({Bucket:config.bucket,Key:config.claimKey}),new ListObjectsV2Command({Bucket:config.bucket})];
  for(const command of commands){const storage=mod.createSmokeStorage(config,f.env,()=>{calls++;throw Error('must not dispatch');});try{await assert.rejects(storage.send(command,{abortSignal:new AbortController().signal}));}finally{storage.destroy();}}
  assert.equal(calls,0);
});

test('expired invocation and already-aborted requests have no auth or storage activity',async()=>{
  const {createOperatorSmokeHandler}=await implementation();let calls=0;
  const h=createOperatorSmokeHandler({env:admitted().env,authorize:async()=>{calls++;return actor;},storage:()=>{calls++;return new SmokeS3();}});
  assert.equal((await h(request(),Date.now()-15001)).status,503);
  assert.equal((await h(request({signal:AbortSignal.abort()}))).status,503);
  assert.equal(calls,0);
});

test('native signed SDK transport runs only the fixed five commands',async()=>{
  const mod=await implementation();
  assert.equal(typeof mod.createSmokeStorage,'function');
  const wire=await wireFixture();
  try {
    const f=admitted();
    const h=mod.createOperatorSmokeHandler({env:f.env,authorize:async()=>actor,storage:(c,e)=>mod.createSmokeStorage(c,e,wire.transport)});
    assert.equal((await h(request())).status,200);
    assert.equal(wire.observed.length,5);
    assert.deepEqual(wire.observed.map(r=>r.method),['PUT','PUT','PUT','HEAD','GET']);
    assert.ok(wire.observed.every(r=>r.headers.authorization.startsWith('AWS4-HMAC-SHA256 ')));
    assert.equal(wire.store.objects.size,2);
  } finally {await wire.close();}
});

test('deadline covers ignored-signal auth and prevents late claim construction', async()=>{
  const {createOperatorSmokeHandler}=await implementation();
  let calls=0, authSignal;
  const h=createOperatorSmokeHandler({env:admitted().env,authorize:async(_r,s)=>{authSignal=s;await new Promise(r=>setTimeout(r,70));return actor;},storage(){calls++;return new SmokeS3();}});
  const response=await h(request(),Date.now()-14990);
  assert.equal(response.status,503);
  await new Promise(r=>setTimeout(r,85));
  assert.equal(calls,0);
  assert.equal(authSignal.aborted,true);
});

test('unarmed refuses before auth or provider construction', async () => {
  const {createOperatorSmokeHandler} = await implementation();
  const handler = createOperatorSmokeHandler({env:{}, authorize(){assert.fail('auth while disabled');}, storage(){assert.fail('provider while disabled');}});
  const response = await handler(new Request('https://booking.example/api/photo-finals/operator-smoke', {method:'POST'}));
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(), {status:'disabled'});
});
