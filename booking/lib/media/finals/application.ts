import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { packageRpc } from './package-runtime.ts';
import { UUID } from './manifest.ts';
import { inspectMediaObjectKey } from '../storage/keys.ts';
import { selectDeliverySources, type DeliverySourceCandidate } from '../../booking/delivery-source-policy.ts';
import type { FinalsRuntime, FinalsIdentity } from './http.ts';
export function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('finals_response_invalid');return value as Record<string,unknown>;}
export function id(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))throw new Error('finals_input_invalid');return value;}
export function list(value:unknown,max=100):Record<string,unknown>[]{if(!Array.isArray(value)||value.length>max)throw new Error('finals_response_invalid');return value.map(record);}
export function common(i:FinalsIdentity){return {p_org:i.scope.organizationId,p_actor:i.actorId,p_booking:i.scope.bookingId,p_property:i.scope.propertyId};}
export async function currentFinals(runtime:FinalsRuntime,identity:FinalsIdentity){return record(await packageRpc(runtime.db,'photo_finals_current',{...common(identity),p_operator:identity.operator}));}
export function currentFinalsDto(state:Record<string,unknown>,identity:FinalsIdentity){
 const base='/api/photo-finals/'+id(identity.scope.bookingId);
 const release=state.release?record(state.release):null,batch=state.batch?record(state.batch):null;
 const complete=state.complete===true;
 const items=complete?list(state.items):[],packages=complete?list(state.packages,2):[];
 if(complete&&(packages.length!==2||items.length<1||!release))throw new Error('finals_response_invalid');
 const candidates:DeliverySourceCandidate[]=packages.map(p=>({category:'photos',label:p.package_type==='mls_zip'?'MLS export (provisional)':'Full-resolution ZIP',source:'pixel_release',slot:p.package_type==='mls_zip'?'photos_mls':'photos_full_res',url:base+'?download='+id(p.id)}));
 return {status:'enabled',recoveryKey:identity.operator?[identity.scope.organizationId,identity.actorId,identity.scope.bookingId,identity.scope.propertyId].map(id).join(':'):null,batchId:batch?id(batch.id):null,revision:release?Number(release.revision_number):0,
  release:identity.operator&&release?{id:id(release.id),state:release.state,revision:release.revision_number}:null,
  versions:identity.operator?list(state.versions).map(v=>({id:id(v.id),status:v.ingest_state,width:v.width_px,height:v.height_px,previewUrl:v.ingest_state==='accepted'?base+'?review='+id(v.id):null})):[],
  gallery:complete?{releaseId:id(release!.id),items:items.map(i=>({id:id(i.id),url:base+'?image='+id(i.id)})),downloads:selectDeliverySources(candidates,{pixelFallbackEnabled:true,pixelPackageSetComplete:true})}:null};
}
/** Fresh authorized current-state selection only. No arbitrary object keys/URLs. */
export async function finalObjectResponse(runtime:FinalsRuntime,identity:FinalsIdentity,state:Record<string,unknown>,query:URLSearchParams):Promise<Response|null>{
 const modes=['download','image','review'].filter(x=>query.has(x));if(!modes.length)return null;
 if(modes.length!==1||[...query].length!==1)throw new Error('finals_input_invalid');
 const mode=modes[0],target=id(query.get(mode));let row:Record<string,unknown>|undefined;
 if(mode==='review'){
  if(!identity.operator)throw new Error('finals_access_denied');
  row=list(state.versions).find(v=>v.id===target&&v.ingest_state==='accepted'&&(!v.rights_effective_at||Date.parse(String(v.rights_effective_at))<=Date.now())&&(!v.rights_expires_at||Date.parse(String(v.rights_expires_at))>Date.now()));
 }else if(state.complete===true){
  row=mode==='download'?list(state.packages,2).find(p=>p.id===target):list(state.items).filter(i=>i.id===target).map(i=>record(i.derivative))[0];
 }
 if(!row)return new Response(null,{status:404,headers:{'Cache-Control':'private, no-store'}});
 const requestId=randomUUID();
 const grant=mode==='download'?record(await packageRpc(runtime.db,'photo_finals_download_begin',{...common(identity),p_operator:identity.operator,p_package:target,p_request:requestId})):null;
 // Use the locked/current canonical row, never the earlier read for downloads.
 if(grant)row=record(grant.package);
 const settle=async(completed:boolean)=>{if(grant){const settled=await packageRpc(runtime.db,'photo_finals_download_finish',{...common(identity),p_operator:identity.operator,p_grant:id(grant.grantId),p_request:requestId,p_completed:completed});if(completed&&settled!==true)throw new Error('finals_download_revoked');}};
 try {
 const key=inspectMediaObjectKey(String(row.object_key),identity.scope.organizationId);
 if(key.objectClass!==(mode==='download'?'packages':mode==='review'?'masters':'derivatives'))throw new Error('finals_response_invalid');
 const expected=String(mode==='download'?row.package_sha256:row.sha256);
 const size=Number(row.byte_size);if(!/^\\x[a-f0-9]{64}$/.test(expected)||!Number.isSafeInteger(size)||size<1||size>(mode==='download'?1_100_000_000:33_554_432)||runtime.storage.location(key.key).bucket!==row.bucket_name)throw new Error('finals_response_invalid');
 const stream=await runtime.storage.getVerified(key.key,AbortSignal.timeout(60_000));
 if(stream.bytes!==size||stream.sha256!==expected.slice(2)){stream.body.destroy();throw new Error('finals_response_invalid');}
 const reader=(Readable.toWeb(stream.body) as ReadableStream<Uint8Array>).getReader();
 let terminal=false,pending:Uint8Array|undefined;
 const body=new ReadableStream<Uint8Array>({
  // One-chunk lookahead holds back final bytes until checksum and audit commit.
  async pull(controller){try{if(!pending){const first=await reader.read();if(first.done)throw new Error('finals_empty_stream');pending=first.value;}const next=await reader.read();if(next.done){terminal=true;await settle(true);controller.enqueue(pending);pending=undefined;controller.close();}else{controller.enqueue(pending);pending=next.value;}}catch(error){stream.body.destroy();if(!terminal){terminal=true;await settle(false);}controller.error(error);}},
  async cancel(){stream.body.destroy();try{await reader.cancel();}finally{if(!terminal){terminal=true;await settle(false);}}}
 },{highWaterMark:0});
 return new Response(body,{headers:{'Content-Type':mode==='download'?'application/zip':'image/jpeg','Content-Length':String(size),'Content-Disposition':`${mode==='download'?'attachment':'inline'}; filename="${mode==='download'?(row.package_type==='mls_zip'?'photos-mls-provisional.zip':'photos-full-resolution.zip'):'photo.jpg'}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});
 } catch(error) {await settle(false);throw error;}
}
