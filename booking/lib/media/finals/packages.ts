import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { FinalsDatabase } from './ingest.ts';
import { verifyFinalJpeg } from './ingest.ts';
import { finalsExecutionAllowed } from './production-config.ts';
import { type PhotoFinalsScope } from './config.ts';
import { packageRpc as rpc, packageLease } from './package-runtime.ts';
import { UUID, preparePhotoFinalsManifest } from './manifest.ts';
import { TRANSFORMS, streamStoredZip, type ZipEntry, transformFinalJpeg } from './transforms.ts';
import { buildDerivativeKey, buildPackageKey, inspectMediaObjectKey, type MediaObjectKey } from '../storage/keys.ts';
import type { R2Storage } from '../storage/r2-core.ts';

type Env=Readonly<Record<string,string|undefined>>;
type Options={db:FinalsDatabase;storage:R2Storage;env:Env;scope:PhotoFinalsScope;jobId:string;workerId:string;budgets?:{totalMs?:number;heartbeatMs?:number}};
function gate(env:Env,scope:PhotoFinalsScope){if(!finalsExecutionAllowed(env,scope))throw new Error('finals_packages_disabled');}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('finals_package_envelope');return value as Record<string,unknown>;}
function text(value:unknown):string{if(typeof value!=='string')throw new Error('finals_package_envelope');return value;}
function identifiers(...ids:unknown[]){if(!ids.every(id=>typeof id==='string' && UUID.test(id)))throw new Error('finals_identifier_invalid');}
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

/** Private preview/approval APIs only; current actor authorization is rechecked in SQL.
 * The caller must pass a trusted authenticated actor, never a browser assertion.
 * Server-issued v2 digest is opaque; it is NOT selection.v1's JS fingerprint.
 */
export async function prepareFinalRelease(o:{db:FinalsDatabase;env:Env;scope:PhotoFinalsScope;actorId:string;batchId:string;releaseId:string;expectedRevision:number;versionIds:readonly string[]}){
 gate(o.env,o.scope);identifiers(o.scope.organizationId,o.scope.bookingId,o.scope.propertyId,o.actorId,o.batchId,o.releaseId);
 if(!Array.isArray(o.versionIds))throw new Error('finals_identifier_invalid');identifiers(...o.versionIds);
 return rpc(o.db,'photo_finals_prepare_release',{p_org:o.scope.organizationId,p_actor:o.actorId,p_booking:o.scope.bookingId,p_property:o.scope.propertyId,p_batch:o.batchId,p_release:o.releaseId,p_expected_revision:o.expectedRevision,p_versions:o.versionIds});
}
export async function approveFinalRelease(o:{db:FinalsDatabase;env:Env;scope:PhotoFinalsScope;actorId:string;releaseId:string;revision:number;manifestSha256:string}){
 gate(o.env,o.scope);identifiers(o.scope.organizationId,o.scope.bookingId,o.scope.propertyId,o.actorId,o.releaseId);return rpc(o.db,'photo_finals_approve_release',{p_org:o.scope.organizationId,p_actor:o.actorId,p_booking:o.scope.bookingId,p_property:o.scope.propertyId,p_release:o.releaseId,p_revision:o.revision,p_hash:o.manifestSha256});
}
async function readOriginal(storage:R2Storage,key:MediaObjectKey,sha:string,size:number,signal:AbortSignal){
 const d=await storage.getVerified(key,signal);try{
  if(d.bytes!==size||d.sha256!==sha||size>33_554_432)throw new Error('finals_master_identity');
  const chunks:Buffer[]=[];let count=0;for await(const chunk of d.body){signal.throwIfAborted();count+=chunk.length;if(count>size)throw new Error('finals_master_bound');chunks.push(Buffer.from(chunk));}
  if(count!==size)throw new Error('finals_master_short');return Buffer.concat(chunks,count);
 }finally{d.body.destroy();}
}
async function verifyStored(storage:R2Storage,key:MediaObjectKey,sha:string,size:number,signal:AbortSignal){
 const d=await storage.getVerified(key,signal);try{if(d.sha256!==sha||d.bytes!==size)throw new Error('finals_output_identity');let count=0;for await(const chunk of d.body){signal.throwIfAborted();count+=chunk.length;}if(count!==size)throw new Error('finals_output_short');}finally{d.body.destroy();}
}
async function putJpeg(storage:R2Storage,key:MediaObjectKey,bytes:Buffer,signal:AbortSignal){
 const sha=hash(bytes);let writeError:unknown;
 try{await storage.putBufferCreateOnly({key,bytes,sha256:sha,contentType:'image/jpeg',signal});}catch(e){writeError=e;}
 try{await verifyStored(storage,key,sha,bytes.length,signal);}catch{throw new Error(writeError?'finals_jpeg_write_unverified':'finals_jpeg_read_unverified');}
 return {key,sha256:sha,bytes:bytes.length,bucket:storage.location(key).bucket};
}
function zipEntry(storage:R2Storage,name:string,key:MediaObjectKey,sha:string,size:number,signal:AbortSignal):ZipEntry{return {name,load:()=>readOriginal(storage,key,sha,size,signal)};}
async function putZip(storage:R2Storage,entries:readonly ZipEntry[],org:string,releaseId:string,kind:'full_res_zip'|'mls_zip',signal:AbortSignal){
 let size=0;const h=createHash('sha256');
 for await(const chunk of streamStoredZip(entries,signal)){h.update(chunk);size+=chunk.length;}
 if(size<1||size>1_100_000_000)throw new Error('finals_zip_bound');
 const sha=h.digest('hex');
 // Storage's canonical parser binds the suffix to actual object bytes for every
 // immutable class. The package row separately binds its approved manifest hash.
 const key=buildPackageKey(org,releaseId,kind,sha);
 const parts=()=>streamStoredZip(entries,signal);
 let writeError:unknown;
 try{await storage.putMultipartCreateOnly({key,parts:parts(),sha256:sha,expectedBytes:size,contentType:'application/zip',signal});}catch(e){writeError=e;}
 try{await verifyStored(storage,key,sha,size,signal);}catch{throw new Error(writeError?'finals_zip_write_unverified':'finals_zip_read_unverified');}
 return {kind,key,sha256:sha,bytes:size,bucket:storage.location(key).bucket};
}

/** Local, operator-invoked sequential processor. Verified per-photo checkpoints
 * survive retries without publishing ready. Two deterministic bounded ZIP passes
 * preserve checksum-addressed identity without filesystem spooling. 30s background
 * renewal, bounded RPCs and 15-minute storage abort budget; production unapproved.
 */
export async function processFinalRelease(o:Options):Promise<{status:'ready'|'not_claimed'}>{
 gate(o.env,o.scope);
 const common={p_org:o.scope.organizationId,p_job:o.jobId};
 const raw=await rpc(o.db,'photo_finals_package_claim',{...common,p_booking:o.scope.bookingId,p_property:o.scope.propertyId,p_worker:o.workerId});
 if(raw===null)return {status:'not_claimed'};
 const claim=object(raw),job=object(claim.job),release=object(claim.release),lease=text(job.finals_lease_token);
 const fenced={...common,p_lease:lease};
 const heartbeat=()=>rpc(o.db,'photo_finals_package_heartbeat',fenced);
 const keepalive=packageLease(heartbeat,o.budgets),signal=keepalive.signal;
 try{
  if(job.id!==o.jobId||job.organization_id!==o.scope.organizationId||job.property_id!==o.scope.propertyId||job.finals_release_id!==release.id||
   release.organization_id!==o.scope.organizationId||release.property_id!==o.scope.propertyId||job.batch_id!==release.batch_id||claim.booking_id!==o.scope.bookingId||release.state!=='packaging')throw new Error('finals_package_scope');
  const m=object(release.manifest);
  if(m.kind!=='finished_jpeg_release.v2'||m.manifest_version!==2||m.release_id!==release.id||m.organization_id!==o.scope.organizationId||m.property_id!==o.scope.propertyId||m.booking_id!==o.scope.bookingId||m.batch_id!==release.batch_id||m.revision_number!==release.revision_number||!isDeepStrictEqual(m.transforms,TRANSFORMS)||!Array.isArray(m.items))throw new Error('finals_package_snapshot');
  if(!/^\\x[a-f0-9]{64}$/.test(text(release.manifest_sha256)))throw new Error('finals_package_hash');
  // Reuse the canonical selection validator for bounded exact-key/rights/order
  // projections. Acceptance time comes from the immutable approval receipt;
  // SQL revalidates the actual current version rows at completion as well.
  const validated=preparePhotoFinalsManifest({scope:{...o.scope,batchId:text(release.batch_id),releaseId:text(release.id),revisionNumber:Number(release.revision_number)},
   batch:{id:text(release.batch_id),organization_id:o.scope.organizationId,booking_id:o.scope.bookingId,property_id:o.scope.propertyId},
   selectedVersionIds:m.items.map(x=>text(object(x).media_version_id)),
   versions:m.items.map(x=>{const i=object(x);return {...i,id:i.media_version_id,organization_id:o.scope.organizationId,property_id:o.scope.propertyId,batch_id:release.batch_id,ingest_state:'accepted',object_tier:'master',sha256:'\\x'+text(i.sha256),accepted_at:release.approved_at};}) as unknown as Parameters<typeof preparePhotoFinalsManifest>[0]['versions'],now:Date.now()});
  if(!isDeepStrictEqual(validated.manifest.items,m.items))throw new Error('finals_package_order');
  const full:ZipEntry[]=[],mlsZip:ZipEntry[]=[];
  if(!Array.isArray(job.finals_package_checkpoints)||job.finals_package_checkpoints.length>200)throw new Error('finals_checkpoint_invalid');
  const checkpoints=job.finals_package_checkpoints.map(object);
  const evidence:Record<string,unknown>[]=[];
  for(const item of validated.manifest.items){
   signal.throwIfAborted();await heartbeat();
   const key=inspectMediaObjectKey(item.object_key,o.scope.organizationId).key;
   if(o.storage.location(key).bucket!==item.bucket_name)throw new Error('finals_master_bucket');
   full.push(zipEntry(o.storage,item.display_filename,key,item.sha256,item.byte_size,signal));
   let bytes:Buffer|undefined;
   for(const kind of ['gallery','mls'] as const){
    let stored=checkpoints.find(e=>e.kind===kind&&e.version_id===item.media_version_id);
    if(stored){
     const checkpointKey=inspectMediaObjectKey(text(stored.key),o.scope.organizationId).key;
     if(checkpointKey!==buildDerivativeKey(o.scope.organizationId,item.media_version_id,1,text(stored.sha256),'jpg')||o.storage.location(checkpointKey).bucket!==stored.bucket||!Number.isSafeInteger(stored.bytes)||Number(stored.bytes)<1||Number(stored.bytes)>33_554_432)throw new Error('finals_checkpoint_invalid');
     await verifyStored(o.storage,checkpointKey,text(stored.sha256),Number(stored.bytes),signal);
    }else{
     if(!bytes){bytes=await readOriginal(o.storage,key,item.sha256,item.byte_size,signal);await verifyFinalJpeg(bytes,item.sha256,item.byte_size);}
     await heartbeat();const transformed=await transformFinalJpeg(bytes,kind);
     const outputKey=buildDerivativeKey(o.scope.organizationId,item.media_version_id,1,hash(transformed.bytes),'jpg');
     await heartbeat();const output=await putJpeg(o.storage,outputKey,transformed.bytes,signal);
     stored={...output,kind,version_id:item.media_version_id,width:transformed.width,height:transformed.height};
     await rpc(o.db,'photo_finals_package_checkpoint',{...fenced,p_evidence:stored},signal);
    }
    evidence.push(stored);
    if(kind==='mls')mlsZip.push(zipEntry(o.storage,item.display_filename,inspectMediaObjectKey(text(stored.key),o.scope.organizationId).key,text(stored.sha256),Number(stored.bytes),signal));
   }
  }
  for(const [kind,entries] of [['full_res_zip',full],['mls_zip',mlsZip]] as const){await heartbeat();evidence.push({...await putZip(o.storage,entries,o.scope.organizationId,text(release.id),kind,signal),entries:validated.manifest.items.length});}
  await keepalive.stop();signal.throwIfAborted();await heartbeat();await rpc(o.db,'photo_finals_package_finish',{...fenced,p_evidence:evidence},signal);
  return {status:'ready'};
 }catch(error){
  await keepalive.stop();
  try{await rpc(o.db,'photo_finals_package_fail',fenced);}catch{throw new AggregateError([new Error('finals_package_processing_failed'),new Error('finals_package_settlement_unconfirmed')],'finals_package_recovery_required');}
  throw error;
 }finally{await keepalive.stop();}
}
export async function dispatchFinalReleases(o:Omit<Options,'jobId'>){
 gate(o.env,o.scope);const ids=await rpc(o.db,'photo_finals_package_due',{p_org:o.scope.organizationId,p_booking:o.scope.bookingId,p_property:o.scope.propertyId});
 if(!Array.isArray(ids)||ids.length>1)throw new Error('finals_package_due_invalid');
 const results=[];for(const id of ids)results.push({jobId:text(id),...await processFinalRelease({...o,jobId:text(id)})});return results;
}
