// Disposable PostgreSQL + real JPEG/R2 adapter seam for the compiled after oracle.
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {scope,identity} from './photo-finals-operator-fixture.mjs';
import {R2Storage} from '../../lib/media/storage/r2-core.ts';
import {PackageLocalS3} from './photo-finals-package-local-s3.mjs';
import {createFinalIntent,processFinalIntent} from '../../lib/media/finals/ingest.ts';
import {prepareFinalRelease,approveFinalRelease} from '../../lib/media/finals/packages.ts';
import {createPackageStatusReader} from '../../lib/media/finals/operator-status.ts';
export {scope,identity};
export async function fixture(){
 if(!/^\/tmp\/pf-after-pg-[^/]+$/.test(process.env.PF_TEST_SOCKET??''))throw Error('isolated postgres only');
 const sql=s=>execFileSync(process.env.PF_TEST_PSQL,['-X','-qAt','-h',process.env.PF_TEST_SOCKET,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8',timeout:10000,stdio:['pipe','pipe','pipe']}).trim();
 const literal=v=>v===null?'null':typeof v==='boolean'||typeof v==='number'?String(v):"'"+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
 const db={async rpc(name,args){if(!/^photo_finals_[a-z_]+$/.test(name))throw Error('rpc');try{return {data:JSON.parse(sql(`set role service_role; select to_jsonb(public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${literal(v)}`).join(',')}));`)||'null'),error:null};}catch{return {data:null,error:{message:'sql_unconfirmed'}};}}};
 const env={PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'synthetic-local',NODE_ENV:'test',PHOTO_FINALS_SYNTHETIC_ACK:'isolated-no-network',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope])};
 const client=new PackageLocalS3();const storage=new R2Storage({client,organizationId:scope.organizationId,buckets:{quarantine:'local-private-quarantine',masters:'local-private-masters',delivery:'local-private-delivery'}});
 const bytes=await sharp({create:{width:2500,height:1250,channels:3,background:'#'+randomUUID().slice(0,6)}}).jpeg().toBuffer(),sha256=createHash('sha256').update(bytes).digest('hex');
 const job=await createFinalIntent({db,env,...identity,requestId:randomUUID(),intentId:randomUUID(),sha256,byteSize:bytes.length});
 await storage.putBufferCreateOnly({key:job.finals_quarantine_key,bytes,sha256,contentType:'image/jpeg'});
 await processFinalIntent({db,env,scope,storage,jobId:job.id,workerId:'fixture'});
 const release=await prepareFinalRelease({db,env,...identity,batchId:job.batch_id,releaseId:randomUUID(),expectedRevision:0,versionIds:[job.finals_version_id]});
 await approveFinalRelease({db,env,...identity,releaseId:release.id,revision:1,manifestSha256:release.manifest_sha256.slice(2)});
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.PF_TEST_POSTGREST??''))throw Error('local PostgREST only');
 const readPackageStatus=createPackageStatusReader({supabaseUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:process.env.PF_TEST_JWT},identity,db,(input,init)=>{const url=new URL(String(input));return fetch(process.env.PF_TEST_POSTGREST+url.pathname.replace('/rest/v1','')+url.search,init);});
 const runtime={db,env,storage,readPackageStatus};
 let abandonedLease;
 const abandon=()=>{
  const query=`set role service_role; select photo_finals_package_claim('${scope.organizationId}','${scope.bookingId}','${scope.propertyId}',(select id from media_ingest_jobs where finals_release_id='${release.id}'),'abandoned-worker');`;
  const args=['-X','-qAt','-h',process.env.PF_TEST_SOCKET,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',query];
  const child=spawnSync(process.execPath,['-e',`require('node:child_process').execFileSync(${JSON.stringify(process.env.PF_TEST_PSQL)},${JSON.stringify(args)},{stdio:'ignore'});process.kill(process.pid,'SIGKILL');`],{timeout:10000});
  if(child.signal!=='SIGKILL')throw Error('abandonment not exercised');
  abandonedLease=sql(`select finals_lease_token from media_ingest_jobs where finals_release_id='${release.id}'`);if(!abandonedLease)throw Error('claim not committed');
  sql(`update media_ingest_jobs set finals_lease_started_at=clock_timestamp()-interval '130 seconds',finals_lease_expires_at=clock_timestamp()-interval '1 second' where finals_release_id='${release.id}'`);
  return {killedAfterClaim:true,expiryAccelerated:true};
 };
 return {runtime,abandon,client,sql,releaseId:release.id,jobId:sql(`select id from media_ingest_jobs where finals_release_id='${release.id}'`),deps:{authorize:async()=>identity,runtime:async()=>runtime},metrics:()=>JSON.parse(sql(`select jsonb_build_object('ready',(select count(*) from gallery_releases where id='${release.id}' and state='ready'),'packages',(select count(*) from media_packages where release_id='${release.id}' and status='ready'),'attempts',(select attempts from media_ingest_jobs where finals_release_id='${release.id}'),'jobs',(select count(*) from media_ingest_jobs where finals_release_id='${release.id}'))`))};
}
