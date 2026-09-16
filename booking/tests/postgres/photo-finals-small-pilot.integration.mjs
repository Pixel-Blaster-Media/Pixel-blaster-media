// Reuses resume integration's actual lifecycle and SQL transport; no hosted Auth/S3.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {FinalsR2Storage} from '../../lib/media/finals/storage.ts';
import {PackageLocalS3} from '../helpers/photo-finals-package-local-s3.mjs';
import {createFinalIntent,processFinalIntent} from '../../lib/media/finals/ingest.ts';
import {prepareFinalRelease,approveFinalRelease,processFinalRelease} from '../../lib/media/finals/packages.ts';
import {createResumeHandler} from '../../lib/media/finals/resume-http.ts';
import {writeFileSync,appendFileSync} from 'node:fs';
import * as pilot from '../../scripts/photo-finals-small-pilot.mjs';
const network=pilot.installNoNetwork(),budget=new pilot.Budget(Date.now()+180000);
const journal=event=>appendFileSync(process.env.PF_EVIDENCE_DIR+'/operations.jsonl',JSON.stringify({...event,used:budget.used})+'\n',{mode:0o600,flush:true});
const socket=process.env.PF_TEST_SOCKET;assert.match(socket??'',/^\/tmp\/pf-small-[^/]+$/);
const sql=s=>{budget.reserve({db:1});journal({kind:'local-sql-before-send',sql:s});return execFileSync(process.env.PF_TEST_PSQL,['-X','-qAt','-h',socket,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:10000}).trim();};
const ids=Object.fromEntries(['organizationId','actorId','propertyId','bookingId','requestId','intentId','releaseId'].map(k=>[k,randomUUID()]));
const plan={target:'isolated-native-postgres',ids,binding:process.env.PF_SMALL_BINDING,expiresAt:Date.now()+180000,retention:'inaccessible-audit-rows',parentArm:false};
const out=process.env.PF_EVIDENCE_DIR;
writeFileSync(out+'/registry.json',JSON.stringify(plan,null,2),{mode:0o600});
assert.equal(typeof pilot.seedLocal,'function','missing atomic synthetic seed');
pilot.seedLocal({plan,binding:plan.binding,sql});
assert.equal(sql(`select count(*) from bookings where id='${ids.bookingId}' and organization_id='${ids.organizationId}' and owner_id='${ids.actorId}' and property_id='${ids.propertyId}' and scheduled_at is null and scheduled_ends_at is null and suppress_realtor_notifications`),'1');
assert.equal(sql('select count(*) from integration_jobs'),'0');
assert.equal(sql('select count(*) from booking_line_items'),'0');
assert.equal(sql(`select count(*) from profiles where id='${ids.actorId}' and organization_id='${ids.organizationId}'`),'1');
// Bad-scope/target never reach SQL; real late transaction failure rolls back.
for(const change of [{target:'https://pixelblastermedia.com'},{ids:{...ids,bookingId:'*'}}]){
 let calls=0;assert.throws(()=>pilot.seedLocal({plan:{...plan,...change},binding:plan.binding,sql:()=>{calls++;}}));assert.equal(calls,0);
}
const failedIds={...Object.fromEntries(Object.keys(ids).map(k=>[k,randomUUID()])),propertyId:ids.propertyId};
assert.throws(()=>pilot.seedLocal({plan:{...plan,ids:failedIds},binding:plan.binding,sql}),/duplicate key/);
assert.equal(sql(`select count(*) from organizations where id='${failedIds.organizationId}'`),'0');
assert.equal(sql(`select count(*) from auth.users where id='${failedIds.actorId}'`),'0');
failedIds.propertyId=randomUUID();pilot.seedLocal({plan:{...plan,ids:failedIds},binding:plan.binding,sql});
const rpcNames=[];
const lit=v=>v===null?'null':typeof v==='boolean'||typeof v==='number'?String(v):"'"+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
const db={async rpc(name,args){assert.match(name,/^photo_finals_[a-z_]+$/);budget.reserve({db:1});rpcNames.push(name);try{const raw=sql(`set role service_role;select to_jsonb(public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${lit(v)}`).join(',')}));`);budget.reserve({dbBytes:Buffer.byteLength(raw)});return {data:JSON.parse(raw||'null'),error:null};}catch(e){return {data:null,error:{message:String(e.stderr??e)}};}}};
const scope={organizationId:ids.organizationId,bookingId:ids.bookingId,propertyId:ids.propertyId};
const env={PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'synthetic-local',NODE_ENV:'test',PHOTO_FINALS_SYNTHETIC_ACK:'isolated-no-network',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope]),PHOTO_FINALS_RESUMABLE_ENABLED:'1',PHOTO_FINALS_DISPATCH_ENABLED:'false'};
class RangeS3 extends PackageLocalS3 {
 rangeGets=0;keys=new Set();commands=[];
 async send(command,options){const i=command.input,n=command.constructor.name;this.commands.push(n);
  assert.ok(!n.includes('Delete')&&!n.includes('List'),'no destructive or inventory operation');assert.ok(i.Key.split('/').includes(ids.organizationId),'exact registered tenant');
  const read=n==='HeadObjectCommand'||n==='GetObjectCommand';budget.reserve(read?{r2B:1}:{r2A:1});
  if(n==='PutObjectCommand'||n==='UploadPartCommand')budget.reserve({objectBytes:i.Body.length});
  this.keys.add(i.Bucket+'/'+i.Key);journal({kind:'local-object-before-send',command:n,key:i.Bucket+'/'+i.Key});
  if(n==='GetObjectCommand'&&i.Range){this.rangeGets++;const object=this.objects.get(i.Bucket+'/'+i.Key);assert.ok(object);const match=/^bytes=(\d+)-(\d+)$/.exec(i.Range);assert.ok(match);const start=Number(match[1]),end=Number(match[2]);assert.ok(end-start+1<=131072);return {$metadata:{httpStatusCode:206},ContentLength:end-start+1,ContentRange:`bytes ${start}-${end}/${object.bytes.length}`,Metadata:object.metadata,ETag:object.etag,Body:Readable.from([object.bytes.subarray(start,end+1)])};}
  return super.send(command,options);
 }
}
const s3=new RangeS3(),storage=new FinalsR2Storage({client:s3,organizationId:ids.organizationId,buckets:{quarantine:'local-private-quarantine',masters:'local-private-masters',delivery:'local-private-delivery'}});
const bytes=await pilot.makeFixture(),sha=createHash('sha256').update(bytes).digest('hex');writeFileSync(out+'/synthetic-small.jpg',bytes,{mode:0o600});
const job=await createFinalIntent({db,env,scope,actorId:ids.actorId,requestId:ids.requestId,intentId:ids.intentId,sha256:sha,byteSize:bytes.length});
await storage.putBufferCreateOnly({key:job.finals_quarantine_key,bytes,contentType:'image/jpeg',sha256:sha});
await processFinalIntent({db,storage,env,scope,jobId:job.id,workerId:'small-local'});
const release=await prepareFinalRelease({db,env,scope,actorId:ids.actorId,batchId:job.batch_id,releaseId:ids.releaseId,expectedRevision:0,versionIds:[job.finals_version_id]});
const approved=await approveFinalRelease({db,env,scope,actorId:ids.actorId,releaseId:release.id,revision:1,manifestSha256:release.manifest_sha256.slice(2)});
const targets=JSON.parse(sql(`select json_agg(row_to_json(p)) from (select id,package_type from media_packages where release_id='${release.id}' order by package_type) p`));
writeFileSync(out+'/package-registry.json',JSON.stringify({targets,jobId:job.id,packageJobId:approved.job_id,batchId:job.batch_id,versionId:job.finals_version_id},null,2),{mode:0o600});
s3.loseFullResponse=true;assert.equal((await processFinalRelease({db,storage,env,scope,jobId:approved.job_id,workerId:'small-local'})).status,'ready');assert.equal(s3.loseFullResponse,false);
assert.equal(sql(`select count(*) from media_package_chunk_indexes where release_id='${release.id}'`),'2');
assert.equal(sql(`select count(*) from media_packages where release_id='${release.id}' and status='ready'`),'2');
assert.throws(()=>sql(`delete from media_package_chunk_indexes where release_id='${release.id}'`),/finals_index_immutable/);
const packages=JSON.parse(sql(`select json_agg(row_to_json(p)) from (select id,package_type,byte_size,object_key from media_packages where release_id='${release.id}' order by package_type) p`));
assert.ok(packages.every(p=>p.byte_size<=8388608));assert.ok(packages.reduce((n,p)=>n+Number(p.byte_size),0)<=16777216);
const full=packages.find(p=>p.package_type==='full_res_zip'),fullBytes=s3.objects.get('local-private-delivery/'+full.object_key).bytes;writeFileSync(out+'/synthetic-small.zip',fullBytes,{mode:0o600});
let sessionHash='12'.repeat(32),authorized=true;
const handler=createResumeHandler({env,authorize:async()=>{budget.reserve({auth:1});return authorized?{actorId:ids.actorId,scope,operator:true,sessionHash}:null;},runtime:async()=>({db,storage,env,issueUpload:async()=>{throw Error('unused');}})});
const base='http://localhost/api/photo-finals/'+ids.bookingId+'/resume';
async function request(url,init){budget.reserve({app:1,...(url.includes('&index=')?{ranges:1,rangeBytes:131072}:{})});return handler(new Request(url,init),ids.bookingId);}
const post=body=>request(base,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(body)});
const response=await post({op:'begin',packageId:full.id});assert.equal(response.status,200,await response.clone().text());const meta=await response.json();assert.equal(meta.chunkCount,64);
const chunks=[];for(let n=0;n<meta.chunkCount;n++){
 if(n===1){sessionHash='34'.repeat(32);const before=s3.rangeGets;assert.notEqual((await request(base+'?transferId='+meta.transferId+'&index=1')).status,206);assert.equal(s3.rangeGets,before);assert.equal((await post({op:'resume',transferId:meta.transferId})).status,200);}
 const r=await request(base+'?transferId='+meta.transferId+'&index='+n);assert.equal(r.status,206,await r.clone().text());const b=Buffer.from(await r.arrayBuffer());assert.equal(createHash('sha256').update(b).digest('hex'),r.headers.get('x-chunk-sha256'));chunks.push(b);
}
const exported=Buffer.concat(chunks);assert.equal(exported.length,meta.byteSize);assert.equal(createHash('sha256').update(exported).digest('hex'),meta.packageSha256);assert.deepEqual(exported,fullBytes);
const rangeBefore=s3.rangeGets;authorized=false;assert.notEqual((await request(base+'?transferId='+meta.transferId+'&index=0')).status,206);assert.equal(s3.rangeGets,rangeBefore);authorized=true;
const foreign=await request(base,{method:'POST',headers:{origin:'https://foreign.invalid','content-type':'application/json'},body:JSON.stringify({op:'begin',packageId:full.id})});assert.equal(foreign.status,403);assert.equal(s3.rangeGets,rangeBefore);
sql(`update media_download_transfers set revoked_at=now() where organization_id='${ids.organizationId}' and id='${meta.transferId}'; update profiles set archived_at=now() where id='${ids.actorId}' and organization_id='${ids.organizationId}';`);
assert.notEqual((await request(base+'?transferId='+meta.transferId+'&index=0')).status,206);assert.equal(s3.rangeGets,rangeBefore);
env.PHOTO_FINALS_ENABLED='false';assert.equal((await post({op:'begin',packageId:full.id})).status,503);
assert.equal(sql(`select count(*) from media_package_chunk_indexes where release_id='${release.id}'`),'2');
assert.equal(sql('select count(*) from integration_jobs'),'0');assert.equal(sql('select count(*) from booking_reminder_jobs'),'0');
assert.equal(sql('select count(*) from bookings where scheduled_at is not null or scheduled_ends_at is not null'),'0');assert.equal(sql('select count(*) from booking_line_items'),'0');assert.equal(s3.uploads.size,0);
const objects=[...s3.objects].map(([key,o])=>({key,bytes:o.bytes.length,sha256:createHash('sha256').update(o.bytes).digest('hex')}));
const tables=JSON.parse(sql(`select json_agg(tablename) from pg_tables where schemaname='public'`)),rows=[];
for(const table of tables){assert.match(table,/^[a-z_]+$/);const count=Number(sql(`select count(*) from ${table}`));if(count)rows.push({table,count,logicalBytes:Number(sql(`select coalesce(sum(pg_column_size(t)),0) from ${table} t`))});}
const retainedIdentities={};
for(const {table} of rows)retainedIdentities[table]=JSON.parse(sql(`select json_agg(jsonb_strip_nulls(jsonb_build_object('id',to_jsonb(t)->'id','organization_id',to_jsonb(t)->'organization_id','profile_id',to_jsonb(t)->'profile_id','package_id',to_jsonb(t)->'package_id','media_version_id',to_jsonb(t)->'media_version_id','release_id',to_jsonb(t)->'release_id'))) from ${table} t`));
assert.equal(network.attempts(),0,'no email/calendar/QuickBooks/push/invite/editor network attempt');
const result={retainedIdentities,networkAttempts:network.attempts(),passed:true,tier:'native PostgreSQL/current source; SQL Auth and S3 doubles; NOT hosted certification',ids,rollbackRecoveryIds:failedIds,targets,transferId:meta.transferId,sha256:meta.packageSha256,byteSize:meta.byteSize,chunkCount:meta.chunkCount,fixtureBytes:bytes.length,fixtureSha256:sha,manifest:release.manifest,objects,rows,budget:budget.used,rpcNames:[...new Set(rpcNames)],commands:[...new Set(s3.commands)],noEffects:{integrationJobs:0,reminderJobs:0,scheduledBookings:0,lineItems:0,auth:'SQL double, no hosted account'},retention:{indexRows:2,actorArchived:true,transferRevoked:true,featureDisabled:true,deleteForbidden:true,localDatabase:'disposed by parent runner'}};
writeFileSync(out+'/integration-result.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({passed:true,byteSize:meta.byteSize,chunkCount:meta.chunkCount,budget:budget.used,sideEffects:result.noEffects}));
