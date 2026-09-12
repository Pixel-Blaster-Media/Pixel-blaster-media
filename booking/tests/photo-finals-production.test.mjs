import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {S3Client} from '@aws-sdk/client-s3';
import {createClient} from '@supabase/supabase-js';
import {loadProductionFinalsConfig,finalsExecutionAllowed} from '../lib/media/finals/production-config.ts';
import {createFinalsPresigner} from '../lib/media/finals/presigner.ts';
import {boundedFinalsFetch} from '../lib/media/finals/transport.ts';
import {createFinalsApplicationDatabase} from '../lib/media/finals/rpc-adapter.ts';
import {packageRpc} from '../lib/media/finals/package-runtime.ts';
import {runFinalsDispatch,finalsCronAuthorized} from '../lib/media/finals/dispatcher.ts';
const uuid=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000000`;
const scope={organizationId:uuid(1),bookingId:uuid(2),propertyId:uuid(3)},identity={scope,actorId:uuid(4),operator:true};
const env=()=>({PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'production',VERCEL_ENV:'production',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope]),PHOTO_FINALS_PRODUCTION_ACK:'private-resources-schema-runtime-certified-v1',PHOTO_FINALS_R2_ACCOUNT_ID:'a'.repeat(32),PHOTO_FINALS_R2_BUCKET:'private-finals-test',PHOTO_FINALS_PRIVATE_BUCKET_ALLOWLIST:'["private-finals-test"]',PHOTO_FINALS_R2_ACCESS_KEY_ID:'b'.repeat(32),PHOTO_FINALS_R2_SECRET_ACCESS_KEY:'c'.repeat(64),NEXT_PUBLIC_SUPABASE_URL:'https://'+'d'.repeat(20)+'.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service-key'});
const sha=b=>createHash('sha256').update(b).digest('hex');
async function serve(fn){const server=createServer(fn);server.listen(0,'127.0.0.1');await once(server,'listening');return {server,origin:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};}
test('production config requires every gate and exact private resources independently of dev',()=>{
 const good=env();assert.ok(finalsExecutionAllowed(good,scope));assert.ok(Object.isFrozen(loadProductionFinalsConfig(good,scope).credentials));
 for(const key of Object.keys(good)){const bad={...good};delete bad[key];assert.equal(finalsExecutionAllowed(bad,scope),false,key);}
 for(const bucket of ['pixel-blaster-dev-synthetic-media','foo-public-bar','bucket.with.dots','127.0.0.1','private-finals-test/path'])assert.equal(finalsExecutionAllowed({...good,PHOTO_FINALS_R2_BUCKET:bucket,PHOTO_FINALS_PRIVATE_BUCKET_ALLOWLIST:JSON.stringify([bucket])},scope),false);
 for(const value of ['["private-finals-test","private-finals-test"]','["*"]','{}','["other-private"]'])assert.equal(finalsExecutionAllowed({...good,PHOTO_FINALS_PRIVATE_BUCKET_ALLOWLIST:value},scope),false);
 assert.equal(finalsExecutionAllowed(good,{...scope,bookingId:uuid(9)}),false);
 for(const url of ['http://localhost','https://evil.supabase.co','https://'+ 'd'.repeat(20)+'.supabase.co/','https://'+ 'd'.repeat(20)+'.supabase.co@evil.example'])assert.equal(finalsExecutionAllowed({...good,NEXT_PUBLIC_SUPABASE_URL:url},scope),false);
});
// Independent SigV4 verification of the SDK's real URL over real loopback HTTP.
// This is a protocol double, not a claim of live R2 enforcement.
function verify(req,body,secret){
 const url=new URL(req.url,'https://'+req.headers.host),q=url.searchParams;
 const signed=q.get('X-Amz-SignedHeaders').split(';');
 const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 const query=[...q].filter(([k])=>k!=='X-Amz-Signature').map(([k,v])=>[enc(k),enc(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:1).map(x=>x.join('=')).join('&');
 const canonical=[req.method,url.pathname,query,signed.map(k=>`${k}:${String(req.headers[k]??'').trim().replace(/\s+/g,' ')}\n`).join(''),signed.join(';'),'UNSIGNED-PAYLOAD'].join('\n');
 const credential=q.get('X-Amz-Credential').split('/'),date=q.get('X-Amz-Date');
 const h=(key,value)=>createHmac('sha256',key).update(value).digest();
 const key=h(h(h(h('AWS4'+secret,credential[1]),credential[2]),credential[3]),'aws4_request');
 assert.equal(h(key,['AWS4-HMAC-SHA256',date,credential.slice(1).join('/'),sha(canonical)].join('\n')).toString('hex'),q.get('X-Amz-Signature'));
 const time=Date.parse(date.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/,'$1-$2-$3T$4:$5:$6Z'));
 assert.ok(Date.now()<time+Number(q.get('X-Amz-Expires'))*1000);
 assert.equal(req.headers['x-amz-checksum-sha256'],Buffer.from(sha(body),'hex').toString('base64'));
 assert.equal(req.headers['x-amz-meta-sha256'],sha(body));assert.equal(Number(req.headers['content-length']),body.length);
}
test('real SDK presign binds durable key/hash/length/headers; tamper/replay rejected on local wire',async()=>{
 const config=loadProductionFinalsConfig(env(),scope),bytes=Buffer.from('synthetic JPEG boundary bytes');
 const target={id:uuid(5),organization_id:scope.organizationId,property_id:scope.propertyId,finals_actor_id:identity.actorId,state:'discovered',finals_sha256:'\\x'+sha(bytes),finals_byte_size:bytes.length,finals_quarantine_key:`quarantine/${scope.organizationId}/${uuid(5)}/${uuid(6)}`,finals_deadline:new Date(Date.now()+60000).toISOString()};
 const client=new S3Client({region:'auto',endpoint:config.endpoint,credentials:{...config.credentials},forcePathStyle:false,requestChecksumCalculation:'WHEN_REQUIRED'});
 let active=true,calls=0;const db={rpc:async(name,args)=>{calls++;assert.equal(name,'photo_finals_upload_target');assert.equal(args.p_actor,identity.actorId);return active?{data:target,error:null}:{data:null,error:{}};}};
 const issue=createFinalsPresigner(client,db,config.bucket);
 const cap=await issue({id:target.id,finals_quarantine_key:'ignored-client-key'},identity),url=new URL(cap.url);
 assert.ok(Date.parse(cap.expiresAt)<=Date.parse(target.finals_deadline));
 assert.equal(url.hostname,`${config.bucket}.${'a'.repeat(32)}.r2.cloudflarestorage.com`);
 for(const h of ['content-length','content-type','if-none-match','x-amz-checksum-sha256','x-amz-meta-sha256'])assert.ok(url.searchParams.get('X-Amz-SignedHeaders').split(';').includes(h),h);
 const objects=new Set();const local=await serve(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);verify(req,Buffer.concat(chunks),config.credentials.secretAccessKey);const key=new URL(req.url,'http://local').pathname;if(objects.has(key))res.writeHead(412).end();else{objects.add(key);res.writeHead(200).end();}}catch{res.writeHead(403).end();}});
 async function send({path=url.pathname+url.search,headers={},body=bytes}={}){return new Promise((resolve,reject)=>{const req=httpRequest(local.origin+path,{method:'PUT',headers:{host:url.host,...cap.headers,'content-length':body.length,...headers}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});req.on('error',reject);req.end(body);});}
 try{
  assert.equal(await send({path:url.pathname.replace(uuid(6),uuid(7))+url.search}),403);
  assert.equal(await send({headers:{'content-type':'image/png'}}),403);
  assert.equal(await send({headers:{'if-none-match':''}}),403);
  assert.equal(await send({body:Buffer.alloc(bytes.length,1)}),403);
  assert.equal(await send({body:Buffer.concat([bytes,Buffer.from('extra')])}),403);
  active=false;await assert.rejects(issue(target,identity));
  // Existing capability is NOT revoked by the DB switch. Provider checks only signature.
  assert.equal(await send(),200);assert.equal(await send(),412);
  assert.equal(objects.size,1);assert.ok(calls>=2);
  const expired=new URL(cap.url);expired.searchParams.set('X-Amz-Date','20000101T000000Z');assert.equal(await send({path:expired.pathname+expired.search}),403);
  active=true;
  const originalDeadline=target.finals_deadline;target.finals_deadline=new Date(Date.now()+1900).toISOString();
  const short=new URL((await issue(target,identity)).url);await new Promise(r=>setTimeout(r,1100));assert.equal(await send({path:short.pathname+short.search}),403,'an intact real signature expires');target.finals_deadline=originalDeadline;
  for(const change of [{finals_deadline:new Date(0).toISOString()},{finals_byte_size:33554433},{finals_actor_id:uuid(9)},{state:'dead_letter'},{finals_quarantine_key:`quarantine/${uuid(9)}/${uuid(5)}/${uuid(6)}`}]){const before={...target};Object.assign(target,change);await assert.rejects(issue(target,identity));Object.assign(target,before);}
 }finally{client.destroy();await local.close();}
});
test('actual Supabase SDK RPC crosses bounded local HTTP transport, no redirects/errors/body overflow',async()=>{
 const origin=env().NEXT_PUBLIC_SUPABASE_URL;let mode='ok',hits=0;
 const local=await serve(async(req,res)=>{hits++;const chunks=[];for await(const c of req)chunks.push(c);assert.equal(req.url,'/rest/v1/rpc/photo_finals_access');assert.equal(req.headers.authorization,'Bearer test-service-key');assert.deepEqual(JSON.parse(Buffer.concat(chunks)),{p_org:scope.organizationId});
  if(mode==='void'){res.writeHead(204).end();return;}
  if(mode==='declared'){res.writeHead(200,{'content-type':'application/json','content-length':'2097153'}).end();return;}
  if(mode==='encoding'){res.writeHead(200,{'content-type':'application/json','content-encoding':'br'}).end('not compressed');return;}
  if(mode==='redirect'){res.writeHead(302,{location:'/secret'}).end();return;}
  if(mode==='error'){res.writeHead(500,{'content-type':'application/json'}).end('{"secret":"must not escape"}');return;}
  if(mode==='stall'){res.writeHead(200,{'content-type':'application/json'});res.write('[');return;}
  res.writeHead(200,{'content-type':mode==='mime'?'text/html':'application/json'});res.end(mode==='large'?'"'+'a'.repeat(2097152)+'"':'{"authorized":true}');
 });
 const bridge=(url,init)=>fetch(local.origin+new URL(url).pathname,init);
 const client=createClient(origin,'test-service-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedFinalsFetch(origin,bridge,100)}});
 const db=createFinalsApplicationDatabase(client);
 try{
  assert.deepEqual(await packageRpc(db,'photo_finals_access',{p_org:scope.organizationId}),{authorized:true});
  mode='void';assert.equal(await packageRpc(db,'photo_finals_access',{p_org:scope.organizationId}),null);
  for(mode of ['redirect','error','mime','large','stall','declared','encoding']){const start=Date.now();await assert.rejects(packageRpc(db,'photo_finals_access',{p_org:scope.organizationId}));assert.ok(Date.now()-start<1500,mode);}
  const count=hits;await assert.rejects(packageRpc(db,'arbitrary_rpc',{}));assert.equal(hits,count);
  mode='stall';const controller=new AbortController();const pending=packageRpc(db,'photo_finals_access',{p_org:scope.organizationId},controller.signal);setTimeout(()=>controller.abort(),10);await assert.rejects(pending);
 }finally{await local.close();}
});
test('dispatcher stays disabled without full config/auth and claims at most one due package',async()=>{
 let calls=0;assert.deepEqual(await runFinalsDispatch({},async()=>{calls++;}),{enabled:false,ok:true});
 assert.equal((await runFinalsDispatch({PHOTO_FINALS_DISPATCH_ENABLED:'true'},async()=>{calls++;})).ok,false);assert.equal(calls,0);
 assert.equal(finalsCronAuthorized(new Request('http://local'),undefined),false);
 const secret='s'.repeat(32);assert.equal(finalsCronAuthorized(new Request('http://local',{headers:{authorization:'Bearer '+secret}}),secret),true);
 const e={...env(),PHOTO_FINALS_DISPATCH_ENABLED:'true',PHOTO_FINALS_DISPATCH_ACTOR_ID:identity.actorId,PHOTO_FINALS_DISPATCH_SCOPE:JSON.stringify(scope)};
 const names=[];const result=await runFinalsDispatch(e,async()=>({env:e,db:{rpc:async(name)=>{names.push(name);return {data:name.endsWith('_due')?[]:null,error:null};}}}));
 assert.deepEqual(result,{enabled:true,ok:true,processed:0});assert.deepEqual(names,['photo_finals_access','photo_finals_package_due']);
});
