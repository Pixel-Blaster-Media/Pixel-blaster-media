import {resumeClock} from './resume-clock.ts';
import {inspectMediaObjectKey} from '../storage/keys.ts';
import {verifyChunkIndex,type PackageChunkIndex} from './chunk-index.ts';
import {packageRpc} from './package-runtime.ts';
import type {ResumeDependencies,ResumeIdentity} from './resume-http.ts';
import type {FinalsRuntime} from './http.ts';
const row=(v:unknown)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('data');return v as Record<string,unknown>;};
const hex=(v:unknown)=>{if(typeof v!=='string')throw Error('data');return v.startsWith('\\x')?v.slice(2):v;};
const args=(i:ResumeIdentity)=>({p_org:i.scope.organizationId,p_actor:i.actorId,p_booking:i.scope.bookingId,p_property:i.scope.propertyId,p_operator:i.operator,p_session:i.sessionHash});
export async function chunkResponse(o:{deps:ResumeDependencies;request:Request;bookingId:string;enteredAt:number;identity:ResumeIdentity;runtime:FinalsRuntime;grant:Record<string,unknown>;attempt:string;transferId:string;chunk:number}):Promise<Response>{
 const {identity,runtime,request,enteredAt}=o;
 const storageClock=resumeClock(enteredAt+25000,request.signal);
 const settleArgs={...args(identity),p_transfer:o.transferId,p_attempt:o.attempt,p_emitted_bytes:0};
 const settle=async(completed:boolean,signal:AbortSignal)=>packageRpc(runtime.db,'photo_finals_chunk_finish',{...settleArgs,p_completed:completed},signal);
 const fail=async()=>{const cleanup=resumeClock(Math.min(enteredAt+80000,Date.now()+10000),new AbortController().signal);try{await cleanup.wait(()=>settle(false,cleanup.signal));}catch{/* Reservation stays charged; expiry is not success. */}finally{cleanup.close();}};
 try{
  const i=o.grant.index as PackageChunkIndex;verifyChunkIndex(i);
  const p=row(o.grant.package),key=inspectMediaObjectKey(String(p.object_key),identity.scope.organizationId);
  if(i.organization_id!==identity.scope.organizationId||p.id!==i.package_id||p.release_id!==i.release_id||key.objectClass!=='packages'||runtime.storage.location(key.key).bucket!==p.bucket_name||hex(p.package_sha256)!==i.package_sha256||Number(p.byte_size)!==i.byte_size)throw Error('binding');
  const offset=o.chunk*i.chunk_size,length=Math.min(i.chunk_size,i.byte_size-offset),sha=i.digests.slice(o.chunk*64,(o.chunk+1)*64);
  if(o.chunk>=i.chunk_count||o.grant.offset!==offset||o.grant.length!==length||o.grant.chunkSha256!==sha)throw Error('geometry');
  const bytes=await storageClock.wait(()=>runtime.storage.getVerifiedPackageChunk({key:key.key,packageSha256:i.package_sha256,totalBytes:i.byte_size,chunkIndex:o.chunk,chunkSha256:sha,signal:storageClock.signal}));
  storageClock.close();
  const forward=resumeClock(enteredAt+70000,request.signal);let terminal=false;
  let streamController:ReadableStreamDefaultController<Uint8Array>;
  const stop=()=>{if(terminal)return;terminal=true;streamController.error(Error('resume_cancelled'));forward.close();void fail();};
  const body=new ReadableStream<Uint8Array>({
   start(c){streamController=c;forward.signal.addEventListener('abort',stop,{once:true});},
   async pull(c){
    if(terminal)return;
    try{
     const fresh=await forward.wait(()=>o.deps.authorize(request,o.bookingId,forward.signal));
     if(!fresh||JSON.stringify(args(fresh))!==JSON.stringify(args(identity)))throw Error('session_changed');
     const ok=await forward.wait(()=>settle(true,forward.signal));
     if(ok!==true)throw Error('handoff_denied');
     forward.check();terminal=true;c.enqueue(bytes);c.close();
    }catch(e){if(!terminal){terminal=true;c.error(e);await fail();}}
    finally{forward.signal.removeEventListener('abort',stop);forward.close();}
   },
   async cancel(){if(!terminal){terminal=true;forward.signal.removeEventListener('abort',stop);forward.close();await fail();}}
  },{highWaterMark:0});
  return new Response(body,{status:206,headers:{'Content-Type':'application/octet-stream','Content-Length':String(length),'Content-Range':`bytes ${offset}-${offset+length-1}/${i.byte_size}`,'ETag':`"${i.package_sha256}"`,'X-Chunk-Sha256':sha,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){await fail();throw error;}finally{storageClock.close();}
}
