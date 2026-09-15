import type {PackageStatus,FinalsIdentity} from './http.ts';
import {id,common} from './application.ts';
import {packageRpc} from './package-runtime.ts';
import type {FinalsDatabase} from './ingest.ts';
/** Only a current lease is running; neither a 202 nor a packaging release is
 * evidence that a worker is alive. Exhausted/unknown rows stop automatic polls. */
export function packageJobStatus(value:unknown,now=Date.now()):PackageStatus{
 const attention:PackageStatus={status:'needs_attention'};
 if(!value||typeof value!=='object'||Array.isArray(value))return attention;
 const j=value as Record<string,unknown>;
 if(j.completed_at!==null||!Number.isSafeInteger(j.attempts)||!Number.isSafeInteger(j.max_attempts)||Number(j.attempts)<0||Number(j.max_attempts)<1||!['discovered','deriving','retryable'].includes(String(j.state)))return attention;
 const expires=j.finals_lease_expires_at===null?null:Date.parse(String(j.finals_lease_expires_at));
 if(expires!==null&&!Number.isFinite(expires))return attention;
 if(j.state==='deriving'&&expires!==null&&expires>now)return {status:'running'};
 if(Number(j.attempts)>=Number(j.max_attempts))return attention;
 return {status:j.state==='discovered'?'pending':'retryable'};
}
/** No schema change: narrow, read-only projection of the existing approved job.
 * Exact tenant/property/release AND batch booking filters, two-row ambiguity
 * bound; current SQL operator authorization brackets the service-only read.
 * This does not expose an arbitrary table/query capability to HTTP callers. */
export function createPackageStatusReader(config:{supabaseUrl:string;serviceKey:string},identity:FinalsIdentity,db:FinalsDatabase,transport:typeof fetch=fetch){
 if(!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.supabaseUrl))throw new Error('finals_status_config');
 const scope={organizationId:id(identity.scope.organizationId),propertyId:id(identity.scope.propertyId),bookingId:id(identity.scope.bookingId)},actorId=id(identity.actorId);
 return async(releaseId:string,parent?:AbortSignal):Promise<PackageStatus>=>{
  if(!identity.operator)throw new Error('finals_status_denied');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10_000);
  const signal=parent?AbortSignal.any([parent,controller.signal]):controller.signal;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   const args={...common({scope,actorId,operator:true}),p_operator:true};
   await packageRpc(db,'photo_finals_access',args,signal);
   const url=new URL('/rest/v1/media_ingest_jobs',config.supabaseUrl);
   url.search=new URLSearchParams({select:'state,attempts,max_attempts,completed_at,finals_lease_expires_at,media_batches!inner(booking_id)',organization_id:'eq.'+scope.organizationId,property_id:'eq.'+scope.propertyId,finals_release_id:'eq.'+id(releaseId),'media_batches.booking_id':'eq.'+scope.bookingId,job_kind:'eq.package',limit:'2'}).toString();
   const response=await transport(url,{method:'GET',headers:{apikey:config.serviceKey,Authorization:'Bearer '+config.serviceKey,Accept:'application/json','Accept-Encoding':'identity'},redirect:'error',cache:'no-store',signal});
   if(response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new Error('finals_status_unconfirmed');
   reader=response.body?.getReader();if(!reader)throw new Error('finals_status_unconfirmed');
   let size=0;const chunks:Uint8Array[]=[];
   for(;;){signal.throwIfAborted();const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>4096)throw new Error('finals_status_bound');chunks.push(next.value);}
   signal.throwIfAborted();const rows:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!Array.isArray(rows)||rows.length!==1)throw new Error('finals_status_unconfirmed');
   await packageRpc(db,'photo_finals_access',args,signal);
   return packageJobStatus(rows[0]);
  }finally{clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{});}
 };
}
