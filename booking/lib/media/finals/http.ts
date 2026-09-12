import { photoFinalsEligibility, type PhotoFinalsScope } from './config.ts';
import { createFinalIntent, processFinalIntent, type FinalsDatabase } from './ingest.ts';
import {prepareFinalRelease,approveFinalRelease,dispatchFinalReleases} from './packages.ts';
import {packageRpc} from './package-runtime.ts';
import {createFinalsApplicationDatabase} from './rpc-adapter.ts';
import {common,currentFinals,currentFinalsDto,finalObjectResponse,id,record} from './application.ts';
import type { R2Storage } from '../storage/r2-core.ts';
export type FinalsIdentity = { actorId: string; scope: PhotoFinalsScope; operator: boolean };
export type UploadCapability={url:string;headers:Record<string,string>;expiresAt:string};
export type FinalsRuntime={db:FinalsDatabase;env:Readonly<Record<string,string|undefined>>;storage:R2Storage;issueUpload(job:Record<string,unknown>,identity:FinalsIdentity):Promise<UploadCapability>};
export type FinalsHttpDependencies = {
 authorize(request: Request, bookingId: string): Promise<FinalsIdentity | null>;
 runtime(identity: FinalsIdentity): Promise<FinalsRuntime | null>;
};
export function finalsJson(value: unknown, status=200) {
 return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
export async function boundedFinalsJson(request:Request):Promise<Record<string,unknown>>{
 if(request.headers.get('content-type')!=='application/json')throw new Error('input');
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^(0|[1-9][0-9]*)$/.test(declared)||Number(declared)>16384))throw new Error('input');
 const reader=request.body?.getReader();if(!reader)throw new Error('input');
 const parts:Uint8Array[]=[];let size=0;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('input_timeout')),10000);});
 try{for(;;){const next=await Promise.race([reader.read(),deadline]);if(next.done)break;size+=next.value.length;if(size>16384)throw new Error('input');parts.push(next.value);}}
 finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
 if(declared!==null&&Number(declared)!==size)throw new Error('input');
 const body:unknown=JSON.parse(Buffer.concat(parts).toString('utf8'));
 if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('input');return body as Record<string,unknown>;
}
export function createFinalsHandler(deps: FinalsHttpDependencies) {
 return async (request: Request, bookingId: string): Promise<Response> => {
  try {
   const identity=await deps.authorize(request,bookingId);
   if(!identity)return finalsJson({error:'Sign in to an authorized workspace.'},401);
   const expectedIdentity=request.headers.get('x-finals-identity');
   if(request.method==='POST'&&expectedIdentity!==null&&expectedIdentity!==[identity.scope.organizationId,identity.actorId,identity.scope.bookingId,identity.scope.propertyId].join(':'))return finalsJson({error:'Session changed. Refresh before making changes.'},409);
   const configured=await deps.runtime(identity);
   if(!configured)return finalsJson({status:'disabled',message:'Private photo finals are unavailable. Storage, schema and runtime verification are required.'},503);
   const runtime={...configured,db:createFinalsApplicationDatabase(configured.db)};
   const gate=photoFinalsEligibility(runtime.env,identity.scope);
   if(!gate.eligible||gate.environment!=='synthetic-local')return finalsJson({status:'disabled'},503);
   await packageRpc(runtime.db,'photo_finals_access',{...common(identity),p_operator:identity.operator});
   if(request.method==='GET'){
    const state=await currentFinals(runtime,identity);
    return await finalObjectResponse(runtime,identity,state,new URL(request.url).searchParams)??finalsJson(currentFinalsDto(state,identity));
   }
   if(request.method!=='POST')return finalsJson({error:'Unavailable operation.'},405);
   if(!identity.operator)return finalsJson({error:'Operator access required.'},403);
   if(request.headers.get('origin')!==new URL(request.url).origin)return finalsJson({error:'Same-origin request required.'},403);
   const body=await boundedFinalsJson(request);
   if(body.op==='intent'){
    if(Object.keys(body).sort().join(',')!=='byteSize,intentId,op,requestId,sha256')return finalsJson({error:'Invalid input.'},400);
    const job=await createFinalIntent({...runtime,...identity,requestId:body.requestId as string,intentId:body.intentId as string,sha256:body.sha256 as string,byteSize:body.byteSize as number}) as Record<string,unknown>;
    if(job.completed_at&&job.state==='accepted')return finalsJson({status:'accepted',jobId:id(job.id),versionId:id(job.finals_version_id)});
    if(['dead_letter','rejected','cancelled'].includes(String(job.state)))return finalsJson({status:'needs_attention',error:'This upload needs operator reconciliation. Its original intent has been retained.'},409);
    const target=record(await packageRpc(runtime.db,'photo_finals_upload_target',{...common(identity),p_job:id(job.id)}));
    const upload=await runtime.issueUpload(target,identity);
    return finalsJson({status:'awaiting_upload',jobId:job.id,batchId:job.batch_id,upload});
   }
   if(body.op==='complete'&&Object.keys(body).sort().join(',')==='jobId,op'){
    await packageRpc(runtime.db,'photo_finals_upload_target',{...common(identity),p_job:id(body.jobId)});
    return finalsJson(await processFinalIntent({...runtime,...identity,jobId:id(body.jobId),workerId:'application-local'}));
   }
   if(body.op==='prepare'&&Object.keys(body).sort().join(',')==='batchId,expectedRevision,op,releaseId,versionIds'){
    if(!Array.isArray(body.versionIds)||body.versionIds.length<1||body.versionIds.length>100||!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0)throw new Error('finals_input_invalid');
    const draft=record(await prepareFinalRelease({...runtime,...identity,batchId:id(body.batchId),releaseId:id(body.releaseId),expectedRevision:Number(body.expectedRevision),versionIds:body.versionIds.map(id)}));
    return finalsJson({id:id(draft.id),revision:draft.revision_number,manifestSha256:String(draft.manifest_sha256).slice(2)});
   }
   if(body.op==='approve'&&Object.keys(body).sort().join(',')==='manifestSha256,op,releaseId,revision'){
    if(typeof body.manifestSha256!=='string'||!/^[0-9a-f]{64}$/.test(body.manifestSha256)||!Number.isSafeInteger(body.revision)||Number(body.revision)<1)throw new Error('finals_input_invalid');
    await approveFinalRelease({...runtime,...identity,releaseId:id(body.releaseId),revision:Number(body.revision),manifestSha256:body.manifestSha256});
    return finalsJson({status:'packaging'});
   }
   if(body.op==='work'&&Object.keys(body).length===1){
    await dispatchFinalReleases({...runtime,...identity,workerId:'application-local'});
    return finalsJson(currentFinalsDto(await currentFinals(runtime,identity),identity));
   }
   return finalsJson({error:'Unavailable operation.'},400);
  }catch{return finalsJson({error:'Photo finals could not be confirmed. Refresh before retrying.'},503);}
 };
}
