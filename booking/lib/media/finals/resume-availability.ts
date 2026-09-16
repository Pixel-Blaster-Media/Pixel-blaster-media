import {packageRpc} from './package-runtime.ts';
import {verifyChunkIndex,type PackageChunkIndex} from './chunk-index.ts';
import {record,id} from './application.ts';
import type {FinalsRuntime,FinalsIdentity} from './http.ts';
export async function resumeAvailability(runtime:FinalsRuntime,identity:FinalsIdentity,state:Record<string,unknown>){
 if(runtime.env.PHOTO_FINALS_RESUMABLE_ENABLED!=='1'||state.complete!==true)return null;
 if(!Array.isArray(state.packages)||state.packages.length>2)throw Error('packages');
 const packageIds:string[]=[];
 for(const value of state.packages){
  const p=record(value),raw=await packageRpc(runtime.db,'photo_finals_resume_index',{p_org:identity.scope.organizationId,p_package:id(p.id)});
  if(raw===null)continue;
  const i=raw as PackageChunkIndex;verifyChunkIndex(i);
  if(i.organization_id!==identity.scope.organizationId||i.package_id!==p.id||i.release_id!==p.release_id||'\\x'+i.package_sha256!==p.package_sha256||i.byte_size!==Number(p.byte_size))throw Error('index_binding');
  packageIds.push(i.package_id);
 }
 return {identity:[identity.scope.organizationId,identity.actorId,identity.scope.bookingId,identity.scope.propertyId].join(':'),packageIds};
}
