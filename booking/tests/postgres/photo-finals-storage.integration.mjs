// Actual JPEG + actual PG RPCs + actual R2Storage command boundary; LOCAL objects only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { R2Storage } from '../../lib/media/storage/r2-core.ts';
import { createFinalIntent, processFinalIntent, dispatchFinalIntents } from '../../lib/media/finals/ingest.ts';
import { LocalS3 } from '../helpers/photo-finals-local-s3.mjs';
const socket=process.env.PF_TEST_SOCKET;
assert.match(socket??'',/^\/tmp\/pf-ingest-[^/]+$/);
const sql=s=>execFileSync(process.env.PF_TEST_PSQL,['-X','-qAt','-h',socket,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8'}).trim();
const db={async rpc(name,args) {
  assert.match(name,/^photo_finals_[a-z_]+$/);
  const literal=v=>v===null?'null':typeof v==='boolean'?String(v):typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
  const params=Object.entries(args).map(([k,v])=>{assert.match(k,/^p_[a-z_0-9]+$/);return `${k}=>${literal(v)}`;}).join(',');
  try {return {data:JSON.parse(sql(`set role service_role; select to_jsonb(public.${name}(${params}));`)||'null'),error:null};}
  catch(error){return {data:null,error};}
}};
const scope={organizationId:'11111111-1111-4111-8111-111111111111',bookingId:'21111111-1111-4111-8111-111111111101',propertyId:'11111111-1111-4111-8111-111111111101'};
const env={PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'synthetic-local',NODE_ENV:'test',PHOTO_FINALS_SYNTHETIC_ACK:'isolated-no-network',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope])};
const client=new LocalS3();
const buckets={quarantine:'local-private-quarantine',masters:'local-private-masters',delivery:'local-private-delivery'};
const storage=new R2Storage({client,organizationId:scope.organizationId,buckets});
const actorId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const requestId=randomUUID();
const digest=b=>createHash('sha256').update(b).digest('hex');
const make=async bytes=>{
  const options={db,env,scope,actorId,requestId,intentId:randomUUID(),sha256:digest(bytes),byteSize:bytes.length};
  const job=await createFinalIntent(options);
  assert.deepEqual(await createFinalIntent(options),job);
  await storage.putBufferCreateOnly({key:job.finals_quarantine_key,bytes,contentType:'image/jpeg',sha256:digest(bytes)});
  return {job,options};
};
const processJob=job=>processFinalIntent({db,storage,env,scope,jobId:job.id,workerId:'local-test'});
const stageCalls=[];
const originalRpc=db.rpc.bind(db);
db.rpc=async(name,args)=>{if(name==='photo_finals_stage') stageCalls.push(args.p_stage);return originalRpc(name,args);};
const bytes=await sharp({create:{width:80,height:60,channels:3,background:'#fed'}}).jpeg().toBuffer();
const {job,options}=await make(bytes);
client.loseNextMasterPut=true;
assert.equal((await processJob(job)).status,'accepted');
assert.deepEqual(stageCalls,['quarantined','validating','scanning']);
assert.equal((await processJob(job)).status,'not_claimed');
assert.equal((await createFinalIntent(options)).finals_version_id,job.finals_version_id);
const v=JSON.parse(sql(`select to_jsonb(v) from media_versions v where id='${job.finals_version_id}'`));
assert.deepEqual(storage.location(v.object_key),{bucket:buckets.masters,key:v.object_key});
assert.equal(v.width_px,80);assert.equal(v.height_px,60);assert.equal(v.sha256,'\\x'+digest(bytes));
assert.deepEqual(client.objects.get(buckets.masters+'/'+v.object_key).bytes,bytes);
assert.equal(client.puts,2);
await assert.rejects(createFinalIntent({...options,intentId:randomUUID()}));
const invalid=await make(Buffer.from('synthetic invalid JPEG'));
await assert.rejects(processJob(invalid.job));
assert.equal(sql(`select state from media_ingest_jobs where id='${invalid.job.id}'`),'rejected');
const png=await make(await sharp(bytes).png().toBuffer());
await assert.rejects(processJob(png.job));
assert.equal(sql(`select state from media_ingest_jobs where id='${png.job.id}'`),'rejected');
// Crash after reservation and immutable promotion: next lease reuses exact identity.
const crash=await make(await sharp({create:{width:16,height:12,channels:3,background:'#123'}}).jpeg().toBuffer());
const leased=(await db.rpc('photo_finals_claim',{p_org:scope.organizationId,p_job:crash.job.id,p_worker:'crashed-worker'})).data;
assert.ok(leased.finals_lease_token);
const target=(await db.rpc('photo_finals_target',{p_org:scope.organizationId,p_job:crash.job.id,p_lease:leased.finals_lease_token})).data;
const crashMaster=`masters/${scope.organizationId}/${target.version.asset_id}/${target.version.id}/${crash.options.sha256}.jpg`;
const crashBytes=client.objects.get(buckets.quarantine+'/'+crash.job.finals_quarantine_key).bytes;
await storage.putBufferCreateOnly({key:crashMaster,bytes:crashBytes,sha256:crash.options.sha256,contentType:'image/jpeg'});
sql(`update media_ingest_jobs set finals_lease_started_at=clock_timestamp()-interval '130 seconds',finals_lease_expires_at=clock_timestamp()-interval '1 second' where id='${crash.job.id}'`);
const beforeRetry=client.puts;
assert.equal((await processJob(crash.job)).versionId,crash.job.finals_version_id);
assert.equal(client.puts,beforeRetry);
assert.equal(sql(`select count(*) from media_job_attempts where job_id='${crash.job.id}'`),'2');
// Expiry after each intermediate phase must be reclaimable, not stuck forever.
for (const [index,phase] of ['quarantined','validating','scanning'].entries()) {
  const item=await make(await sharp({create:{width:20+index,height:10,channels:3,background:'#987'}}).jpeg().toBuffer());
  const claim=(await db.rpc('photo_finals_claim',{p_org:scope.organizationId,p_job:item.job.id,p_worker:'phase-crash'})).data;
  for (const stage of ['quarantined','validating','scanning']) {
    assert.equal((await db.rpc('photo_finals_stage',{p_org:scope.organizationId,p_job:item.job.id,p_lease:claim.finals_lease_token,p_stage:stage})).error,null);
    if (stage===phase) break;
  }
  sql(`update media_ingest_jobs set finals_lease_started_at=clock_timestamp()-interval '130 seconds',finals_lease_expires_at=clock_timestamp()-interval '1 second' where id='${item.job.id}'`);
  assert.equal((await processJob(item.job)).status,'accepted');
}
const afterPhases=client.puts;
await assert.rejects(processFinalIntent({db,storage,masterBucket:buckets.masters,env:{...env,PHOTO_FINALS_ENVIRONMENT:'production',VERCEL_ENV:'production'},scope,jobId:job.id,workerId:'local-test'}),/disabled/);
assert.equal(client.puts,afterPhases);
const dispatched=await make(await sharp({create:{width:8,height:8,channels:3,background:'#678'}}).jpeg().toBuffer());
const results=await dispatchFinalIntents({db,storage,env,scope,workerId:'local-dispatch'});
assert.ok(results.length<=2);
assert.equal(results.find(r=>r.jobId===dispatched.job.id)?.status,'accepted');
assert.equal(sql(`select state from media_ingest_jobs where id='${dispatched.job.id}'`),'accepted');
console.log(JSON.stringify({passed:true,jpeg:'80x60',adapter:'actual-postgresql-rpc-and-R2Storage-with-LOCAL-in-memory-S3-commands',liveStorageProof:false,ambiguousPutRecovered:true,invalidInputsRejected:true}));
