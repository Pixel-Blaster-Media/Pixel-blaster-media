// Local-only reproduction: production driver transport and route providers are doubles.
import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {mkdtemp,chmod,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const root=new URL('../',import.meta.url).href;
registerHooks({resolve(s,c,n){
 if(s==='server-only')return {url:'data:text/javascript,export {};',shortCircuit:true};
 if(s==='@/lib/supabase/server')return {url:'data:text/javascript,export async function getServerSupabase(){globalThis.authCalls++;return globalThis.reviewDb;}',shortCircuit:true};
 if(s==='@/lib/media/finals/operator-smoke')return {url:'data:text/javascript,'+encodeURIComponent(`export {createOperatorSmokeHandler} from '${root}lib/media/finals/operator-smoke.ts';export function createSmokeStorage(){globalThis.storageCalls++;return globalThis.reviewStorage;}`),shortCircuit:true};
 if(s.startsWith('@/'))return n(root+s.slice(2)+'.ts',c);
 return n(s,c);
}});
const uuid=n=>`${n}1111111-1111-4111-8111-111111111111`,hash=x=>createHash('sha256').update(x).digest('hex');
const now=Date.now(),origin='https://pixelblastermedia.com';
const resource={accountId:'a'.repeat(32),bucket:'private-smoke-existing',endpoint:`https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,privateAccess:'verified-private-no-public-domains',retentionUntil:new Date(now+86400000).toISOString(),allowance:'one-run-3-class-a-2-class-b-132096-upload-bytes'};
function admission(run){const prefix=`operator-smoke/v1/${uuid(1)}/${run}`;return {version:'non-certifying-storage-smoke-v1',issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),runId:run,actorId:uuid(2),organizationId:uuid(1),origin,claimKey:prefix+'/claim.json',objectKey:prefix+'/payload.bin',resourceSha256:hash(JSON.stringify(resource))};}
const ticketA=admission(uuid(3)),serverB=admission(uuid(4));
Object.assign(process.env,{PHOTO_FINALS_OPERATOR_SMOKE_ENABLED:'1',PHOTO_FINALS_SMOKE_ADMISSION:JSON.stringify(serverB),PHOTO_FINALS_SMOKE_RESOURCE:JSON.stringify(resource),PHOTO_FINALS_SMOKE_R2_ACCESS_KEY_ID:'b'.repeat(32),PHOTO_FINALS_SMOKE_R2_SECRET_ACCESS_KEY:'c'.repeat(64)});
globalThis.reviewDb={auth:{async getSession(){return {data:{session:{access_token:'x.'+Buffer.from(JSON.stringify({sub:uuid(2),session_id:uuid(8)})).toString('base64url')+'.x'}},error:null};},async getUser(){return {data:{user:{id:uuid(2)}},error:null};}},from(table){const q={select(){return q;},eq(){return q;},in(){return q;},abortSignal(){return q;},async maybeSingle(){return {error:null,data:table==='profiles'?{id:uuid(2),organization_id:uuid(1),role:'admin',archived_at:null}:{organization_id:uuid(1),role:'admin'}};}};return q;}};
const objects=new Map();globalThis.reviewStorage={async send(c){const i=c.input;if(c.constructor.name==='PutObjectCommand'){if(objects.has(i.Key))throw Object.assign(Error(),{name:'PreconditionFailed',$metadata:{httpStatusCode:412}});objects.set(i.Key,i);return {$metadata:{httpStatusCode:200},ETag:'"fixture"'};}const o=objects.get(i.Key);const r={$metadata:{httpStatusCode:200},ETag:'"fixture"',ContentLength:o.Body.length,ContentType:o.ContentType,Metadata:o.Metadata};return c.constructor.name==='HeadObjectCommand'?r:{...r,$metadata:{httpStatusCode:206},ContentLength:1024,ContentRange:'bytes 1024-2047/65536',Body:Readable.from([o.Body.subarray(1024,2048)])};}};
const route=await import(root+'app/api/photo-finals/operator-smoke/route.ts');
let calls=0, responseMutation=null, headerMutation=null;
const admissionDigest=a=>hash(JSON.stringify(['photo-finals-operator-smoke-admission-sha256-v1',...['version','issuedAt','expiresAt','runId','actorId','organizationId','origin','claimKey','objectKey','resourceSha256'].map(k=>a[k])]));
https.request=(url,options,callback)=>{calls++;const req=new EventEmitter();req.destroy=()=>{};req.end=()=>{void (async()=>{assert.equal(options.headers['content-length'],'0');const headers={...options.headers};headerMutation?.(headers);const reply=await route.POST(new Request(url,{method:options.method,headers}));let dto=await reply.json();if(responseMutation)dto=responseMutation(dto);const incoming=Readable.from([Buffer.from(JSON.stringify(dto))]);incoming.statusCode=reply.status;incoming.headers={'content-type':'application/json'};callback(incoming);})().catch(e=>req.emit('error',e));};return req;};syncBuiltinESMExports();
test('ticket A cannot execute server admission B through actual route and driver', async()=>{
 globalThis.authCalls=0;globalThis.storageCalls=0;
 const dir=await realpath(await mkdtemp(tmpdir()+'/smoke-binding-'));await chmod(dir,0o700);
 try {
  const authorizationFile=dir+'/authorization.json',cookieFile=dir+'/session.txt',journal=dir+'/journal.jsonl';
  await writeFile(authorizationFile,JSON.stringify({authorization:'separately-authorized-one-shot-hosted-smoke-v1',admission:ticketA}),{mode:0o600});await writeFile(cookieFile,'fixture=not-real',{mode:0o600});
  const driver=await import(root+'scripts/verify-photo-finals-operator-smoke.mjs');
  const result=await driver.runOperatorSmoke({mode:'hosted',authorizationFile,cookieFile,journal});
  assert.equal(result.status,'invalid-request');
  assert.equal(globalThis.authCalls,0);assert.equal(globalThis.storageCalls,0);assert.equal(objects.size,0);assert.equal(calls,1);
  const rows=(await readFile(journal,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].registration.runId,ticketA.runId);
  assert.ok(!rows.some(r=>r.result?.status==='verified-storage-smoke'));
 } finally {await rm(dir,{recursive:true,force:true});}
});

async function exercise({server=ticketA, resourceRecord=resource, mutateHeaders=null, mutateResponse=null, rejected=false}={}) {
 Object.assign(process.env,{PHOTO_FINALS_SMOKE_ADMISSION:JSON.stringify(server),PHOTO_FINALS_SMOKE_RESOURCE:JSON.stringify(resourceRecord)});
 objects.clear();calls=0;globalThis.authCalls=0;globalThis.storageCalls=0;
 headerMutation=mutateHeaders;responseMutation=mutateResponse;
 const dir=await realpath(await mkdtemp(tmpdir()+'/smoke-binding-'));await chmod(dir,0o700);
 try {
  const authorizationFile=dir+'/authorization.json',cookieFile=dir+'/session.txt',journal=dir+'/journal.jsonl';
  await writeFile(authorizationFile,JSON.stringify({authorization:'separately-authorized-one-shot-hosted-smoke-v1',admission:ticketA}),{mode:0o600});await writeFile(cookieFile,'fixture=not-real',{mode:0o600});
  const {runOperatorSmoke}=await import(root+'scripts/verify-photo-finals-operator-smoke.mjs');
  const options={mode:'hosted',authorizationFile,cookieFile,journal};
  let result;
  if(rejected)await assert.rejects(runOperatorSmoke(options),/operator_smoke_stop_unconfirmed/);
  else result=await runOperatorSmoke(options);
  assert.equal(calls,1);
  await assert.rejects(runOperatorSmoke(options));assert.equal(calls,1);
  const rows=(await readFile(journal,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].admissionSha256,admissionDigest(ticketA));
  if(rejected){assert.equal(rows[1].state,'STOP-unconfirmed-no-retry');assert.ok(!rows.some(r=>r.result));}
  return {result,rows};
 } finally {headerMutation=null;responseMutation=null;await rm(dir,{recursive:true,force:true});}
}

test('same run resource or expiry drift refuses before any provider activity',async()=>{
 const changed={...resource,bucket:'other-private-smoke'};
 for(const options of [
  {server:{...ticketA,expiresAt:new Date(now+90000).toISOString()}},
  {server:{...ticketA,resourceSha256:hash(JSON.stringify(changed))},resourceRecord:changed},
 ]){
  const {result}=await exercise(options);assert.equal(result.status,'invalid-request');
  assert.equal(globalThis.authCalls,0);assert.equal(globalThis.storageCalls,0);assert.equal(objects.size,0);
 }
});

test('missing malformed and wrong assertions refuse at actual route before Auth/storage',async()=>{
 for(const value of [null,'bad','A'.repeat(64),'0'.repeat(64)]){
  const {result}=await exercise({mutateHeaders:h=>{if(value===null)delete h['x-photo-finals-smoke-admission-sha256'];else h['x-photo-finals-smoke-admission-sha256']=value;}});
  assert.equal(result.status,'invalid-request');assert.equal(globalThis.authCalls,0);assert.equal(globalThis.storageCalls,0);assert.equal(objects.size,0);
 }
});

test('matching admission echoes exact identity into result and sealed journal',async()=>{
 const {result,rows}=await exercise({server:Object.fromEntries(Object.entries(ticketA).reverse())});
 assert.equal(result.status,'verified-storage-smoke');assert.equal(result.admissionSha256,admissionDigest(ticketA));
 assert.equal(rows[1].result.admissionSha256,rows[0].admissionSha256);
 assert.equal(globalThis.authCalls,1);assert.equal(globalThis.storageCalls,1);
 assert.deepEqual([...objects.keys()],[ticketA.claimKey,ticketA.objectKey]);
});

test('driver rejects missing or mismatched success identity without retry or success journal',async()=>{
 for(const value of [undefined,admissionDigest(serverB)])await exercise({rejected:true,mutateResponse:d=>({...d,admissionSha256:value})});
});

test('digest binds every admission semantic and is independent of property order',async()=>{
 const {smokeAdmissionSha256}=await import(root+'lib/media/finals/operator-smoke-binding.mjs');
 assert.equal(smokeAdmissionSha256(ticketA),admissionDigest(ticketA));
 for(const key of Object.keys(ticketA))assert.notEqual(smokeAdmissionSha256({...ticketA,[key]:ticketA[key]+'x'}),admissionDigest(ticketA),key);
});
