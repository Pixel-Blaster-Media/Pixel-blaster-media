// Parent-owned cross-layer gate: actual application/SQL/storage adapter, local auth and S3 doubles.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import sharp from 'sharp';
import {R2Storage} from '../../lib/media/storage/r2-core.ts';
import {PackageLocalS3} from '../helpers/photo-finals-package-local-s3.mjs';
import {createFinalIntent,processFinalIntent} from '../../lib/media/finals/ingest.ts';
import {prepareFinalRelease,approveFinalRelease,processFinalRelease} from '../../lib/media/finals/packages.ts';
import {createResumeHandler} from '../../lib/media/finals/resume-http.ts';
const socket=process.env.PF_TEST_SOCKET;assert.match(socket??'',/^\/tmp\/pf-resume-[^/]+$/);
const sql=s=>execFileSync(process.env.PF_TEST_PSQL,['-X','-qAt','-h',socket,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const lit=v=>v===null?'null':typeof v==='boolean'||typeof v==='number'?String(v):"'"+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
const rpcCalls=[];
const db={async rpc(name,args){assert.match(name,/^photo_finals_[a-z_]+$/);rpcCalls.push(name);try{return {data:JSON.parse(sql(`set role service_role;select to_jsonb(public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${lit(v)}`).join(',')}));`)||'null'),error:null};}catch(error){return {data:null,error:{message:String(error.stderr)}};}}};
const scope={organizationId:'11111111-1111-4111-8111-111111111111',bookingId:'21111111-1111-4111-8111-111111111101',propertyId:'11111111-1111-4111-8111-111111111101'};
const actorId=randomUUID();sql(`insert into profiles values ('${actorId}','${scope.organizationId}','admin','resume-parent@example.invalid',null);insert into organization_members values ('${scope.organizationId}','${actorId}','admin')`);
const env={PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'synthetic-local',NODE_ENV:'test',PHOTO_FINALS_SYNTHETIC_ACK:'isolated-no-network',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope]),PHOTO_FINALS_RESUMABLE_ENABLED:'1'};
const browserGate=process.env.PF_RESUME_BROWSER==='1';let slow=false;
class RangeS3 extends PackageLocalS3 {
 rangeGets=0;
 async send(command,options){
  const i=command.input;
  if(command.constructor.name==='GetObjectCommand'&&i.Range){
   this.rangeGets++;if(slow)await new Promise(r=>setTimeout(r,2500));const full=await super.send(command,options);const chunks=[];for await(const b of full.Body)chunks.push(b);const bytes=Buffer.concat(chunks);
   const match=/^bytes=(\d+)-(\d+)$/.exec(i.Range);assert.ok(match);const start=Number(match[1]),end=Number(match[2]);assert.ok(end-start+1<=131072);
   return {...full,$metadata:{httpStatusCode:206},ContentLength:end-start+1,ContentRange:`bytes ${start}-${end}/${bytes.length}`,Body:Readable.from([bytes.subarray(start,end+1)])};
  }
  return super.send(command,options);
 }
}
const s3=new RangeS3();const storage=new R2Storage({client:s3,organizationId:scope.organizationId,buckets:{quarantine:'local-private-quarantine',masters:'local-private-masters',delivery:'local-private-delivery'}});
const bytes=browserGate?await sharp(randomBytes(2048*2048*3),{raw:{width:2048,height:2048,channels:3}}).jpeg({quality:95}).toBuffer():await sharp({create:{width:250,height:120,channels:3,background:'#246'}}).jpeg().toBuffer();const sha=createHash('sha256').update(bytes).digest('hex');
const job=await createFinalIntent({db,env,scope,actorId,requestId:randomUUID(),intentId:randomUUID(),sha256:sha,byteSize:bytes.length});
await storage.putBufferCreateOnly({key:job.finals_quarantine_key,bytes,contentType:'image/jpeg',sha256:sha});
await processFinalIntent({db,storage,env,scope,jobId:job.id,workerId:'parent-local'});
const release=await prepareFinalRelease({db,env,scope,actorId,batchId:job.batch_id,releaseId:randomUUID(),expectedRevision:0,versionIds:[job.finals_version_id]});
const approved=await approveFinalRelease({db,env,scope,actorId,releaseId:release.id,revision:1,manifestSha256:release.manifest_sha256.slice(2)});
await processFinalRelease({db,storage,env,scope,jobId:approved.job_id,workerId:'parent-local'});
assert.equal(sql(`select count(*) from media_package_chunk_indexes where release_id='${release.id}'`),'2','same atomic publication includes indexes');
let sessionHash='12'.repeat(32),authorized=true;let authCalls=0;
const handler=createResumeHandler({env,authorize:async()=>{authCalls++;return authorized?{actorId,scope,operator:true,sessionHash}:null;},runtime:async()=>({db,storage,env,issueUpload:async()=>{throw Error('unused');}})});
const base='http://localhost/api/photo-finals/'+scope.bookingId+'/resume';
const post=body=>handler(new Request(base,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(body)}),scope.bookingId);
const response=await post({op:'begin',packageType:'full_res_zip'});assert.equal(response.status,200,await response.clone().text());const meta=await response.json();
assert.equal(typeof meta.transferId,'string');assert.equal(meta.chunkSize,131072);assert.ok(!JSON.stringify(meta).includes('object_key'));
if(browserGate){
 const {routeBrowserProof}=await import('../helpers/photo-finals-resume-browser.mjs');
 console.log(JSON.stringify(await routeBrowserProof({handler,scope,metadata:meta,setSlow:value=>{slow=value;}})));
}else{
assert.equal(meta.chunkCount,1);
const chunkUrl=base+'?transferId='+meta.transferId+'&index=0';
const chunk=await handler(new Request(chunkUrl),scope.bookingId);assert.equal(chunk.status,206,await chunk.clone().text());const exported=Buffer.from(await chunk.arrayBuffer());assert.equal(createHash('sha256').update(exported).digest('hex'),meta.packageSha256);assert.equal(exported.readUInt32LE(0),0x04034b50);assert.equal(s3.rangeGets,1);
assert.ok(authCalls>=3,'admission and handoff reauthorize independently');
const status=await handler(new Request(base+'?transferId='+meta.transferId),scope.bookingId);assert.equal(status.status,200);
sessionHash='34'.repeat(32);const stale=await handler(new Request(chunkUrl),scope.bookingId);assert.notEqual(stale.status,206);assert.equal(s3.rangeGets,1,'stale session cannot dispatch');
const resumed=await post({op:'resume',transferId:meta.transferId});assert.equal(resumed.status,200,await resumed.clone().text());
authorized=false;const denied=await handler(new Request(chunkUrl),scope.bookingId);assert.notEqual(denied.status,206);assert.equal(s3.rangeGets,1);
console.log(JSON.stringify({passed:true,tier:'local real PostgreSQL + production application/storage adapter; synthetic auth/S3 doubles, not live provider or iPhone',atomicPublication:true,routeChunkVerified:true,explicitSessionRebind:true,freshHandoffAuth:true,providerRangeGets:s3.rangeGets,rpcOperations:[...new Set(rpcCalls)]}));
}
