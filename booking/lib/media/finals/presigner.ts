import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { inspectMediaObjectKey } from '../storage/keys.ts';
import { packageRpc } from './package-runtime.ts';
import { common, id, record } from './application.ts';
import type { FinalsDatabase } from './ingest.ts';
import type { FinalsIdentity, UploadCapability } from './http.ts';
/** A reusable short-lived S3 capability, NOT a revocable/one-use app token.
 * A fresh durable SQL target authorizes issuance. Acceptance separately streams,
 * hashes, counts, decodes and fences current authority in the existing worker. */
export function createFinalsPresigner(client:S3Client,db:FinalsDatabase,bucket:string){
 return async(job:Record<string,unknown>,identity:FinalsIdentity):Promise<UploadCapability>=>{
  if(!identity.operator)throw new Error('finals_upload_denied');
  const jobId=id(job.id);
  const target=record(await packageRpc(db,'photo_finals_upload_target',{...common(identity),p_job:jobId}));
  const key=inspectMediaObjectKey(String(target.finals_quarantine_key),identity.scope.organizationId);
  const bytes=Number(target.finals_byte_size),digest=String(target.finals_sha256);
  if(target.id!==jobId||target.organization_id!==identity.scope.organizationId||target.property_id!==identity.scope.propertyId||key.objectClass!=='quarantine'||!key.key.startsWith(`quarantine/${identity.scope.organizationId}/${jobId}/`)||!/^\\x[0-9a-f]{64}$/.test(digest)||!Number.isSafeInteger(bytes)||bytes<1||bytes>33554432||!['discovered','retryable','quarantined'].includes(String(target.state))||target.finals_actor_id!==identity.actorId||target.completed_at!=null||(target.finals_lease_expires_at!=null&&Date.parse(String(target.finals_lease_expires_at))>Date.now()))throw new Error('finals_upload_target_invalid');
  const now=new Date(),deadline=Date.parse(String(target.finals_deadline));
  const seconds=Math.min(60,Math.floor((deadline-now.getTime())/1000));
  if(!Number.isSafeInteger(seconds)||seconds<1)throw new Error('finals_upload_expired');
  const hash=digest.slice(2),checksum=Buffer.from(hash,'hex').toString('base64');
  const headers={'content-type':'image/jpeg','if-none-match':'*','x-amz-checksum-sha256':checksum,'x-amz-meta-sha256':hash};
  const command=new PutObjectCommand({Bucket:bucket,Key:key.key,ContentLength:bytes,ContentType:'image/jpeg',IfNoneMatch:'*',ChecksumSHA256:checksum,Metadata:{sha256:hash}});
  const url=await getSignedUrl(client,command,{expiresIn:seconds,signingDate:now,signableHeaders:new Set(['content-length',...Object.keys(headers)]),unhoistableHeaders:new Set(['x-amz-checksum-sha256','x-amz-meta-sha256'])});
  // Content-Length is signed, but browsers must derive this forbidden header from
  // the exact Blob body. CORS must permit the four returned author headers.
  return {url,headers,expiresAt:new Date(Math.floor(now.getTime()/1000)*1000+seconds*1000).toISOString()};
 };
}
