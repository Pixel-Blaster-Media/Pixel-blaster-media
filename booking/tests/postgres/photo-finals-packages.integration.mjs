import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { R2Storage } from '../../lib/media/storage/r2-core.ts';
import { PackageLocalS3 as LocalS3 } from '../helpers/photo-finals-package-local-s3.mjs';
import { createFinalIntent,processFinalIntent } from '../../lib/media/finals/ingest.ts';
const socket=process.env.PF_TEST_SOCKET;assert.match(socket??'',/^\/tmp\/pf-package-[^/]+$/);
const sql=s=>execFileSync(process.env.PF_TEST_PSQL,['-X','-qAt','-h',socket,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const literal=v=>v===null?'null':typeof v==='boolean'||typeof v==='number'?String(v):"'"+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
const db={async rpc(name,args){assert.match(name,/^photo_finals_[a-z_]+$/);try{return {data:JSON.parse(sql(`set role service_role; select to_jsonb(public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${literal(v)}`).join(',')}));`)||'null'),error:null};}catch(error){return {data:null,error};}}};
const call=async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data;};
const scope={organizationId:'11111111-1111-4111-8111-111111111111',bookingId:'21111111-1111-4111-8111-111111111101',propertyId:'11111111-1111-4111-8111-111111111101'};
const env={PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'synthetic-local',NODE_ENV:'test',PHOTO_FINALS_SYNTHETIC_ACK:'isolated-no-network',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope])};
const actorId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',requestId=randomUUID();
const client=new LocalS3(),buckets={quarantine:'local-private-quarantine',masters:'local-private-masters',delivery:'local-private-delivery'};
const storage=new R2Storage({client,organizationId:scope.organizationId,buckets});
const digest=b=>createHash('sha256').update(b).digest('hex');
const sources=[],jobs=[];
for(const colour of ['#123','#abc']){
 const bytes=await sharp({create:{width:2500,height:1250,channels:3,background:colour}}).jpeg().toBuffer();sources.push(bytes);
 const job=await createFinalIntent({db,env,scope,actorId,requestId,intentId:randomUUID(),sha256:digest(bytes),byteSize:bytes.length});jobs.push(job);
 await storage.putBufferCreateOnly({key:job.finals_quarantine_key,bytes,contentType:'image/jpeg',sha256:digest(bytes)});
 await processFinalIntent({db,storage,env,scope,jobId:job.id,workerId:'fixture'});
}
const common={p_org:scope.organizationId,p_actor:actorId,p_booking:scope.bookingId,p_property:scope.propertyId,p_batch:jobs[0].batch_id};
const draft=await call('photo_finals_prepare_release',{...common,p_release:randomUUID(),p_expected_revision:0,p_versions:jobs.map(j=>j.finals_version_id).reverse()});
assert.equal(draft.revision_number,1);
const approve={p_org:scope.organizationId,p_actor:actorId,p_booking:scope.bookingId,p_property:scope.propertyId,p_release:draft.id,p_revision:1,p_hash:draft.manifest_sha256.slice(2)};
const approved=await call('photo_finals_approve_release',approve);
assert.equal(approved.state,'packaging');
assert.deepEqual(await call('photo_finals_approve_release',approve),approved);
const {processFinalRelease,dispatchFinalReleases}=await import('../../lib/media/finals/packages.ts');
assert.throws(()=>sql(`set role service_role; update gallery_releases set state='ready' where id='${draft.id}'`),/finals_release_not_complete/);
await assert.rejects(call('photo_finals_approve_release',{...approve,p_hash:'0'.repeat(64)}),/finals_stale_selection/);
await assert.rejects(call('photo_finals_approve_release',{...approve,p_actor:randomUUID()}),/finals_actor_denied/);
await assert.rejects(call('photo_finals_approve_release',{...approve,p_booking:randomUUID()}),/finals_release_denied/);
await assert.rejects(call('photo_finals_approve_release',{...approve,p_org:randomUUID()}),/finals_actor_denied/);
sql(`update profiles set archived_at=now() where id='${actorId}'`);
await assert.rejects(call('photo_finals_approve_release',approve),/finals_actor_denied/);
sql(`update profiles set archived_at=null where id='${actorId}'`);
assert.throws(()=>sql(`set role authenticated; select photo_finals_approve_release(${Object.values(approve).map(literal).join(',')})`),/permission denied/);
const claimArgs={p_org:scope.organizationId,p_booking:scope.bookingId,p_property:scope.propertyId,p_job:approved.job_id,p_worker:'lease-test'};
assert.equal(await call('photo_finals_package_claim',{...claimArgs,p_booking:randomUUID()}),null);
const lease1=await call('photo_finals_package_claim',claimArgs);
assert.equal(await call('photo_finals_package_claim',claimArgs),null);
const stale={p_org:scope.organizationId,p_job:approved.job_id,p_lease:lease1.job.finals_lease_token};
sql(`update media_ingest_jobs set finals_lease_started_at=clock_timestamp()-interval '130 seconds',finals_lease_expires_at=clock_timestamp()-interval '1 second' where id='${approved.job_id}'`);
for(const name of ['heartbeat','fail','finish'])await assert.rejects(call('photo_finals_package_'+name,{...stale,...(name==='finish'?{p_evidence:[]}: {})}),/finals_lease_lost/);
const lease2=await call('photo_finals_package_claim',claimArgs);assert.notEqual(lease1.job.finals_lease_token,lease2.job.finals_lease_token);
await assert.rejects(call('photo_finals_package_heartbeat',stale),/finals_lease_lost/);
await call('photo_finals_package_fail',{...stale,p_lease:lease2.job.finals_lease_token});
sql(`update media_ingest_jobs set next_attempt_at=now() where id='${approved.job_id}'`);
// Full ZIP and derivatives can physically exist, but failure of MLS must expose NONE ready.
client.failMls=true;client.loseFullResponse=true;
await assert.rejects(processFinalRelease({db,storage,env,scope,jobId:approved.job_id,workerId:'partial-test'}),/finals_zip_write_unverified/);
assert.equal(sql(`select count(*) from media_packages where release_id='${draft.id}' and status='ready'`),'0');
assert.equal(sql(`select count(*) from media_derivatives where batch_id='${jobs[0].batch_id}' and status='ready'`),'0');
assert.equal(sql(`select state from gallery_releases where id='${draft.id}'`),'packaging');
client.failMls=false;sql(`update media_ingest_jobs set next_attempt_at=now() where id='${approved.job_id}'`);
const originalRpc=db.rpc.bind(db);let finishEvidence;let malformedProbes=0;
db.rpc=async(name,args)=>{
 if(name==='photo_finals_package_finish'){
  finishEvidence=structuredClone(args.p_evidence);
  // Each required field removed individually, both one-null dimension permutations,
  // and missing/duplicate evidence: all must roll back every ready row.
  const variants=[args.p_evidence.slice(1),[args.p_evidence[0],...args.p_evidence.slice(1,-1),args.p_evidence[0]]];
  for(let n=0;n<args.p_evidence.length;n++)for(const key of Object.keys(args.p_evidence[n])){const copy=structuredClone(args.p_evidence);delete copy[n][key];variants.push(copy);}
  for(const key of ['width','height']){const copy=structuredClone(args.p_evidence);copy[0][key]=null;variants.push(copy);}
  for(const p_evidence of variants){const r=await originalRpc(name,{...args,p_evidence});assert.ok(r.error);malformedProbes++;assert.equal(sql(`select count(*) from media_packages where release_id='${draft.id}' and status='ready'`),'0');assert.equal(sql(`select count(*) from media_derivatives where batch_id='${jobs[0].batch_id}' and status='ready'`),'0');}
  sql(`create function public.expire_package_mid_finish() returns trigger language plpgsql as $$begin update public.media_ingest_jobs set finals_lease_expires_at=clock_timestamp()-interval '1 millisecond' where id='${approved.job_id}';return new;end$$;create trigger expire_package_mid_finish before update on media_derivatives for each row when(new.status='ready') execute function public.expire_package_mid_finish();`);
  const expired=await originalRpc(name,args);assert.match(expired.error?.stderr??'',/finals_lease_lost/,'expiry during finish must rollback on the lease fence');
  assert.equal(sql(`select count(*) from media_packages where release_id='${draft.id}' and status='ready'`),'0');
  sql('drop trigger expire_package_mid_finish on media_derivatives;drop function public.expire_package_mid_finish()');
 }
 return originalRpc(name,args);
};
const result=await processFinalRelease({db,storage,env,scope,jobId:approved.job_id,workerId:'package-test'});
db.rpc=originalRpc;
assert.equal(result.status,'ready');
assert.equal(sql(`select state from gallery_releases where id='${draft.id}'`),'ready');
// Inspect actual package bytes independently with Python's ZIP parser and CRC.
const archiveProofs=[];
for(const kind of ['full_res_zip','mls_zip']){
 const e=finishEvidence.find(e=>e.kind===kind),bytes=client.objects.get(e.bucket+'/'+e.key).bytes;
 assert.equal(digest(bytes),e.sha256);
 const info=JSON.parse(execFileSync('python3',['-c','import sys,io,zipfile,json,hashlib;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps({"names":z.namelist(),"crc":z.testzip(),"hashes":[hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()]}))'],{input:bytes,encoding:'utf8'}));
 assert.deepEqual(info.names,['001.jpg','002.jpg']);assert.equal(info.crc,null);
 if(kind==='full_res_zip')assert.deepEqual(info.hashes,sources.map(digest).reverse());
 else assert.deepEqual(info.hashes,jobs.map(j=>finishEvidence.find(e=>e.kind==='mls'&&e.version_id===j.finals_version_id).sha256).reverse());
 archiveProofs.push({kind,entries:info.names.length,crcVerified:true,exactOrderAndContent:true});
}
for(const e of finishEvidence.filter(e=>e.kind==='gallery'||e.kind==='mls')){
 const bytes=client.objects.get(e.bucket+'/'+e.key).bytes,meta=await sharp(bytes).metadata();
 assert.equal(meta.format,'jpeg');assert.equal(meta.width,2048);assert.equal(meta.height,1024);assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);
 assert.equal(digest(bytes),e.sha256);
}
assert.equal(client.uploads.size,0);
assert.equal((await processFinalRelease({db,storage,env,scope,jobId:approved.job_id,workerId:'done'})).status,'not_claimed');
await assert.rejects(processFinalRelease({db,storage,env:{...env,PHOTO_FINALS_ENVIRONMENT:'production',VERCEL_ENV:'production'},scope,jobId:approved.job_id,workerId:'disabled'}),/disabled/);
const frozen=sql(`select manifest::text from gallery_releases where id='${draft.id}'`);
for(const change of [`manifest='{}'::jsonb`,`manifest_sha256=decode(repeat('b',64),'hex')`,`revision_number=99`])assert.throws(()=>sql(`set role service_role; update gallery_releases set ${change} where id='${draft.id}'`),/immutable/);
assert.throws(()=>sql(`set role service_role; update gallery_release_items set display_filename='changed.jpg' where release_id='${draft.id}'`),/immutable/);
// A correction is a new immutable release, with independent packages. Old bytes remain.
let revision=1;
const nextDraft=async(ids=jobs.map(j=>j.finals_version_id))=>{const r=await call('photo_finals_prepare_release',{...common,p_release:randomUUID(),p_expected_revision:revision,p_versions:ids});revision++;return r;};
const approval=r=>({...approve,p_release:r.id,p_revision:r.revision_number,p_hash:r.manifest_sha256.slice(2)});
const correction=await nextDraft([jobs[0].finals_version_id]);
assert.equal(correction.supersedes_release_id,draft.id);
const correctionJob=await call('photo_finals_approve_release',approval(correction));
assert.equal((await dispatchFinalReleases({db,storage,env,scope,workerId:'correction'}))[0].jobId,correctionJob.job_id);
assert.equal(sql(`select manifest::text from gallery_releases where id='${draft.id}'`),frozen);
assert.equal(sql(`select entry_count from media_packages where release_id='${correction.id}' and package_type='full_res_zip'`),'1');
// Stale head revision and late-child rollback leave no approved residue.
const oldDraft=await nextDraft();const newer=await nextDraft();
sql(`update gallery_releases set manifest_sha256=decode(repeat('c',64),'hex') where id='${newer.id}'`);
await assert.rejects(call('photo_finals_approve_release',{...approval(newer),p_hash:'c'.repeat(64)}),/finals_stale_selection/);
sql(`update gallery_releases set manifest_sha256=decode('${newer.manifest_sha256.slice(2)}','hex') where id='${newer.id}'`);
await assert.rejects(call('photo_finals_approve_release',approval(oldDraft)),/finals_stale_revision/);
await assert.rejects(call('photo_finals_prepare_release',{...common,p_release:randomUUID(),p_expected_revision:0,p_versions:[]}),/finals_stale_revision/);
sql(`create function public.inject_package_failure() returns trigger language plpgsql as $$begin raise exception 'injected_late_package';end$$;create trigger inject_package_failure before insert on media_ingest_jobs for each row when(new.job_kind='package') execute function public.inject_package_failure();`);
await assert.rejects(call('photo_finals_approve_release',approval(newer)),/injected_late_package/);
assert.equal(sql(`select state from gallery_releases where id='${newer.id}'`),'review_pending');
assert.equal(sql(`select count(*) from media_packages where release_id='${newer.id}'`),'0');
assert.equal(sql(`select count(*) from gallery_release_items where release_id='${newer.id}' and approval_state='approved'`),'0');
sql('drop trigger inject_package_failure on media_ingest_jobs;drop function public.inject_package_failure()');
const {observedRace}=await import('../helpers/photo-finals-package-race.mjs');
const rpcSql=(name,args)=>`select to_jsonb(public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${literal(v)}`).join(',')}))`;
const races=[];
for(const order of ['approval-first','item-first']){
 const r=await nextDraft();const approveSql=rpcSql('photo_finals_approve_release',approval(r));
 const change=`update gallery_release_items set display_filename='changed.jpg' where release_id='${r.id}' and position=0`;
 races.push({case:order,...await observedRace({sql,socket,first:order==='approval-first'?approveSql:change,second:order==='approval-first'?change:approveSql,errorPattern:order==='approval-first'?/23514:[\s\S]*Approved release items are immutable/:/40001:[\s\S]*finals_stale_selection/})});
 assert.equal(sql(`select state from gallery_releases where id='${r.id}'`),order==='approval-first'?'packaging':'review_pending');
 assert.equal(sql(`select count(*) from media_packages where release_id='${r.id}'`),order==='approval-first'?'2':'0');
}
// Concurrent approval replay enqueues exactly one job and exactly two packages.
const concurrent=await nextDraft();const approvalSql=rpcSql('photo_finals_approve_release',approval(concurrent));
races.push({case:'approval-replay',...await observedRace({sql,socket,first:approvalSql,second:approvalSql})});
assert.equal(sql(`select count(*) from media_ingest_jobs where finals_release_id='${concurrent.id}'`),'1');
assert.equal(sql(`select count(*) from media_packages where release_id='${concurrent.id}'`),'2');
const concurrentJob=await call('photo_finals_approve_release',approval(concurrent));
const finalClaimArgs={...claimArgs,p_job:concurrentJob.job_id};
races.push({case:'lease-claim',...await observedRace({sql,socket,first:rpcSql('photo_finals_package_claim',finalClaimArgs),second:rpcSql('photo_finals_package_claim',finalClaimArgs)})});
assert.equal(sql(`select attempts from media_ingest_jobs where id='${concurrentJob.job_id}'`),'1');
// Expired final attempt terminalizes durably; it cannot remain unclaimable retryable.
sql(`update media_ingest_jobs set max_attempts=1,finals_lease_started_at=now()-interval '130 seconds',finals_lease_expires_at=now()-interval '1 second' where id='${concurrentJob.job_id}'`);
assert.equal(await call('photo_finals_package_claim',finalClaimArgs),null);
assert.equal(sql(`select state from media_ingest_jobs where id='${concurrentJob.job_id}'`),'dead_letter');
console.log(JSON.stringify({passed:true,realJpeg:true,archives:archiveProofs,malformedEvidenceRollbackProbes:malformedProbes,races:races.map(({case:kind,observedLockWait})=>({case:kind,observedLockWait})),partialFailureRecovered:true,correctionImmutable:true,liveStorageProof:false}));
