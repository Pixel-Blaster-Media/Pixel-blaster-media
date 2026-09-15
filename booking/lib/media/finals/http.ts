import {finalsDeadline,deadlineDatabase} from './operator-deadline.ts';
import { finalsExecutionAllowed } from './production-config.ts';
import { type PhotoFinalsScope } from './config.ts';
import { createFinalIntent, processFinalIntent, type FinalsDatabase } from './ingest.ts';
import {prepareFinalRelease,approveFinalRelease,dispatchFinalReleases} from './packages.ts';
import {packageRpc} from './package-runtime.ts';
import {createFinalsApplicationDatabase} from './rpc-adapter.ts';
import {common,currentFinals,currentFinalsDto,finalObjectResponse,id,record} from './application.ts';
import type { R2Storage } from '../storage/r2-core.ts';
import {inspectMediaObjectKey} from '../storage/keys.ts';
export type FinalsIdentity = { actorId: string; scope: PhotoFinalsScope; operator: boolean };
export type UploadCapability={url:string;headers:Record<string,string>;expiresAt:string};
export type PackageStatus={status:'pending'|'running'|'retryable'|'needs_attention'};
export type FinalsRuntime={readPackageStatus?(releaseId:string,signal?:AbortSignal):Promise<PackageStatus>;budgets?:{totalMs:number};db:FinalsDatabase;env:Readonly<Record<string,string|undefined>>;storage:R2Storage;issueUpload(job:Record<string,unknown>,identity:FinalsIdentity):Promise<UploadCapability>};
export type FinalsHttpDependencies = {
 authorize(request: Request, bookingId: string, signal?:AbortSignal): Promise<FinalsIdentity | null>;
 runtime(identity: FinalsIdentity): Promise<FinalsRuntime | null>;
 /** Invocation-lifetime scheduling only; approval SQL owns durable intent. */
 schedule?(callback:()=>Promise<void>):void;
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
 return async (request: Request, bookingId: string, enteredAt=Date.now()): Promise<Response> => {
  const admission=request.method==='POST'?finalsDeadline(enteredAt+20_000):null;
  const control=<T>(fn:()=>Promise<T>)=>admission?admission.wait(fn):fn();
  try {
   const identity=await control(()=>deps.authorize(request,bookingId,admission?.signal));
   if(!identity)return finalsJson({error:'Sign in to an authorized workspace.'},401);
   const expectedIdentity=request.headers.get('x-finals-identity');
   if(request.method==='POST'&&expectedIdentity!==null&&expectedIdentity!==[identity.scope.organizationId,identity.actorId,identity.scope.bookingId,identity.scope.propertyId].join(':'))return finalsJson({error:'Session changed. Refresh before making changes.'},409);
   const configured=await control(()=>deps.runtime(identity));
   if(!configured)return finalsJson({status:'disabled',message:'Private photo finals are unavailable. Storage, schema and runtime verification are required.'},503);
   const runtime={...configured,db:createFinalsApplicationDatabase(configured.db)};
   if(!finalsExecutionAllowed(runtime.env,identity.scope))return finalsJson({status:'disabled'},503);
   await packageRpc(runtime.db,'photo_finals_access',{...common(identity),p_operator:identity.operator},admission?.signal);
   if(request.method==='GET'){
    const state=await currentFinals(runtime,identity);
    const object=await finalObjectResponse(runtime,identity,state,new URL(request.url).searchParams);
    if(object)return object;
    let dto=currentFinalsDto(state,identity);
    let job=identity.operator&&dto.release?.state==='packaging'?await runtime.readPackageStatus?.(dto.release.id):null;
    if(job?.status==='needs_attention'){
     // Finish may commit between the release and job reads. Re-read before
     // stopping the observer so a completed job cannot strand a ready release.
     const latest=currentFinalsDto(await currentFinals(runtime,identity),identity);
     if(latest.release?.id!==dto.release?.id||latest.release?.state!=='packaging')job=null;
     dto=latest;
    }
    return finalsJson({...dto,packageJob:job?{status:['pending','running','retryable','needs_attention'].includes(job.status)?job.status:'needs_attention'}:null});
   }
   if(request.method!=='POST')return finalsJson({error:'Unavailable operation.'},405);
   if(!identity.operator)return finalsJson({error:'Operator access required.'},403);
   if(request.headers.get('origin')!==new URL(request.url).origin)return finalsJson({error:'Same-origin request required.'},403);
   const body=await control(()=>boundedFinalsJson(request));
   if(body.op!=='work')admission?.close();
   if(body.op==='reconcile'&&Object.keys(body).length===1){const settled=await packageRpc(runtime.db,'photo_finals_reconcile_expired',common(identity));return finalsJson({settled,...record(await packageRpc(runtime.db,'photo_finals_inventory',common(identity)))});}
   if(body.op==='inventory'&&Object.keys(body).length===1)return finalsJson(await packageRpc(runtime.db,'photo_finals_inventory',common(identity)));
   if(body.op==='revoke'&&Object.keys(body).sort().join(',')==='grantId,op'){await packageRpc(runtime.db,'photo_finals_download_revoke',{...common(identity),p_grant:id(body.grantId)});return finalsJson({status:'revoked'});}
   if(body.op==='intent'){
    if(Object.keys(body).sort().join(',')!=='byteSize,intentId,op,requestId,sha256')return finalsJson({error:'Invalid input.'},400);
    const job=await createFinalIntent({...runtime,db:{rpc:(name,args)=>runtime.db.rpc(name==='photo_finals_create_intent'?'photo_finals_recover_intent':name,args)},...identity,requestId:body.requestId as string,intentId:body.intentId as string,sha256:body.sha256 as string,byteSize:body.byteSize as number}) as Record<string,unknown>;
    if(job.completed_at&&job.state==='accepted')return finalsJson({status:'accepted',jobId:id(job.id),versionId:id(job.finals_version_id)});
    if(['dead_letter','rejected','cancelled'].includes(String(job.state))||Date.parse(String(job.finals_deadline))<=Date.now())return finalsJson({status:'needs_attention',error:'This expired or terminal upload is retained in the authorized inventory. No replacement or deletion was performed.'},409);
    const target=record(await packageRpc(runtime.db,'photo_finals_upload_target',{...common(identity),p_job:id(job.id)}));
    let present=false;
    try{const head=await runtime.storage.head(inspectMediaObjectKey(String(target.finals_quarantine_key),identity.scope.organizationId).key,AbortSignal.timeout(10000));if(head.sha256!==String(target.finals_sha256).slice(2)||head.bytes!==Number(target.finals_byte_size))throw new Error('identity');present=true;}
    catch(error){const e=error as {$metadata?:{httpStatusCode?:number}};if(e.$metadata?.httpStatusCode!==404)throw error;}
    if(present)return finalsJson({status:'uploaded',jobId:job.id,batchId:job.batch_id});
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
    const state=await control(()=>currentFinals({...runtime,db:deadlineDatabase(runtime.db,admission!.signal)},identity)),release=state.release?record(state.release):null;
    if(!release||release.state!=='packaging'||!release.approved_at||!runtime.readPackageStatus||!deps.schedule)return finalsJson({status:'needs_attention'},409);
    const status=await control(()=>runtime.readPackageStatus!(id(release.id),admission?.signal));
    if(!['pending','running','retryable'].includes(status.status))return finalsJson({status:'needs_attention'},409);
    // Capture validated IDs, not the request, storage keys or service client.
    const principal={actorId:id(identity.actorId),operator:true,scope:{organizationId:id(identity.scope.organizationId),bookingId:id(identity.scope.bookingId),propertyId:id(identity.scope.propertyId)}};
    admission?.check();
    deps.schedule(async()=>{
     const workAt=Math.min(enteredAt+220_000,Date.now()+200_000),work=finalsDeadline(workAt);
     try{
      work.check(30_000);
      const fresh=await work.wait(()=>deps.runtime(principal));
      if(!fresh||!finalsExecutionAllowed(fresh.env,principal.scope))return;
      const db=createFinalsApplicationDatabase(fresh.db);
      await packageRpc(db,'photo_finals_access',{...common(principal),p_operator:true},work.signal);
      work.check(30_000);
      await dispatchFinalReleases({...fresh,db,...principal,workerId:'application-local',deadlines:{work:workAt,settlement:enteredAt+280_000}});
     }catch{
      // No replay or fabricated readiness: unclaimed intent / expired fenced
      // lease remains the recovery authority, including ambiguous settlement.
     }finally{work.close();}
    });
    return finalsJson({status:'packaging'},202);
   }
   return finalsJson({error:'Unavailable operation.'},400);
  }catch{return finalsJson({error:'Photo finals could not be confirmed. Refresh before retrying.'},503);}finally{admission?.close();}
 };
}
