export const scope={organizationId:'11111111-1111-4111-8111-111111111111',bookingId:'21111111-1111-4111-8111-111111111101',propertyId:'11111111-1111-4111-8111-111111111101'};
export const identity={scope,actorId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',operator:true};
export const releaseId='31111111-1111-4111-8111-111111111101';
export function fixture(){
 const callbacks=[],calls=[];let allowed=true;
 const runtime={env:{PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'synthetic-local',NODE_ENV:'test',PHOTO_FINALS_SYNTHETIC_ACK:'isolated-no-network',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope])},storage:{},
  readPackageStatus:async()=>({status:'pending'}),
  db:{async rpc(name){calls.push(name);if(name==='photo_finals_access'&&!allowed)return {error:{message:'denied'}};return {error:null,data:name==='photo_finals_current'?{release:{id:releaseId,state:'packaging',approved_at:new Date().toISOString(),revision_number:1},batch:null,versions:[],items:[],packages:[],complete:false}:name==='photo_finals_package_due'?[]:null};}}};
 const deps={authorize:async()=>identity,runtime:async()=>runtime,schedule:fn=>callbacks.push(fn)};
 return {deps,runtime,callbacks,calls,revoke(){allowed=false;}};
}
