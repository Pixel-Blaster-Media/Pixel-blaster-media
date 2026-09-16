import {resumeClock} from './resume-clock.ts';
import {chunkResponse} from './resume-chunk.ts';
import {currentFinals} from './application.ts';
import {randomUUID} from 'node:crypto';
import type {FinalsIdentity, FinalsRuntime} from './http.ts';
import {boundedFinalsJson} from './http.ts';
import {packageRpc,ResumeBudgetExhausted} from './package-runtime.ts';
import {finalsExecutionAllowed} from './production-config.ts';
import {verifyChunkIndex,type PackageChunkIndex} from './chunk-index.ts';
export type ResumeIdentity=FinalsIdentity & {sessionHash:string};
export type ResumeDependencies={env:Readonly<Record<string,string|undefined>>;authorize(request:Request,bookingId:string,signal:AbortSignal):Promise<ResumeIdentity|null>;runtime(identity:FinalsIdentity):Promise<FinalsRuntime|null>};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function id(v:unknown):string{if(typeof v!=='string'||!UUID.test(v))throw Error('input');return v;}
function row(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('data');return v as Record<string,unknown>;}
function hex(v:unknown):string{if(typeof v!=='string')throw Error('data');return v.startsWith('\\x')?v.slice(2):v;}
function index(value:unknown):PackageChunkIndex{const r=row(value);const i={...r,manifest_sha256:hex(r.manifest_sha256),package_sha256:hex(r.package_sha256),index_sha256:hex(r.index_sha256),digests:hex(r.digests)} as PackageChunkIndex;verifyChunkIndex(i);return i;}
function args(i:ResumeIdentity){return {p_org:i.scope.organizationId,p_actor:i.actorId,p_booking:i.scope.bookingId,p_property:i.scope.propertyId,p_operator:i.operator,p_session:i.sessionHash};}
function dto(value:unknown,identity:ResumeIdentity){const r=row(value),t=row(r.transfer),i=index(r.index);if(i.organization_id!==identity.scope.organizationId)throw Error('tenant');return {transferId:id(t.id),packageId:i.package_id,packageSha256:i.package_sha256,indexSha256:i.index_sha256,byteSize:i.byte_size,chunkSize:i.chunk_size,chunkCount:i.chunk_count,chunkDigests:i.digests.match(/.{64}/g)!,coveredChunks:r.coverage,expiresAt:t.expires_at};}
export function createResumeHandler(deps:ResumeDependencies){return async(request:Request,bookingId:string,_enteredAt=Date.now()):Promise<Response>=>{
 if(deps.env.PHOTO_FINALS_RESUMABLE_ENABLED!=='1')return json({status:'disabled'},503);
 const clock=resumeClock(_enteredAt+10000,request.signal);
 try{
  const identity=await clock.wait(()=>deps.authorize(request,id(bookingId),clock.signal));
  if(!identity||! /^[0-9a-f]{64}$/.test(identity.sessionHash))return json({error:'Sign in required.'},401);
  if(!finalsExecutionAllowed(deps.env,identity.scope))return json({status:'disabled'},503);
  const runtime=await clock.wait(()=>deps.runtime(identity));if(!runtime)return json({status:'disabled'},503);
  const rpc=(name:string,a:Record<string,unknown>)=>clock.wait(()=>packageRpc(runtime.db,name,a,clock.signal));
  if(request.method==='GET'){
   const q=new URL(request.url).searchParams;
   if([...q.keys()].sort().join(',')==='index,transferId'){
    const raw=q.get('index');if(!raw||!/^(0|[1-9][0-9]{0,4})$/.test(raw))return json({error:'input'},400);
    const transferId=id(q.get('transferId')),chunk=Number(raw);
    const grant=row(await rpc('photo_finals_chunk_begin',{...args(identity),p_transfer:transferId,p_chunk:chunk,p_request:randomUUID()}));
    const attempt=id(row(grant.attempt).id);
    // Admission is over. All following clocks remain relative to route entry.
    clock.close();
    return await chunkResponse({deps,request,bookingId,enteredAt:_enteredAt,identity,runtime,grant,attempt,transferId,chunk});
   }
   if([...q.keys()].sort().join(',')!=='transferId')return json({error:'input'},400);
   return json(dto(await rpc('photo_finals_transfer_status',{...args(identity),p_transfer:id(q.get('transferId'))}),identity));
  }
  if(request.method!=='POST')return json({error:'method'},405);
  if(request.headers.get('origin')!==new URL(request.url).origin)return json({error:'origin'},403);
  const body=await clock.wait(()=>boundedFinalsJson(request));
  if(body.op==='resume'&&Object.keys(body).sort().join(',')==='op,transferId')return json(dto(await rpc('photo_finals_transfer_resume',{...args(identity),p_transfer:id(body.transferId)}),identity));
  if(body.op==='begin'&&Object.keys(body).sort().join(',')==='op,packageType'){
   const type=body.packageType==='originals'?'full_res_zip':body.packageType==='web'?'mls_zip':body.packageType;
   if(type!=='full_res_zip'&&type!=='mls_zip')return json({error:'input'},400);
   const current=await clock.wait(()=>currentFinals(runtime,identity));
   const selected=current.complete===true&&Array.isArray(current.packages)?current.packages.map(row).find(p=>p.package_type===type):null;
   if(!selected)return json({error:'No current package.'},409);
   return json(dto(await rpc('photo_finals_transfer_begin',{...args(identity),p_package:id(selected.id),p_transfer:randomUUID()}),identity));
  }
  if(body.op!=='begin'||Object.keys(body).sort().join(',')!=='op,packageId')return json({error:'input'},400);
  return json(dto(await rpc('photo_finals_transfer_begin',{...args(identity),p_package:id(body.packageId),p_transfer:randomUUID()}),identity));
 }catch(error){if(error instanceof ResumeBudgetExhausted)return json({status:'budget-exhausted',recovery:'contact-support',error:'This package has reached its transfer safety limit. Retained progress is unchanged. Contact support; retrying or starting a new transfer will not reset the limit.'},429);return json({error:'Transfer could not be confirmed.'},503);}finally{clock.close();}
};}
