import { timingSafeEqual } from 'node:crypto';
import { UUID } from './manifest.ts';
import { finalsExecutionAllowed } from './production-config.ts';
import { packageRpc } from './package-runtime.ts';
import { dispatchFinalReleases } from './packages.ts';
import { createFinalsApplicationDatabase } from './rpc-adapter.ts';
import type { FinalsIdentity, FinalsRuntime } from './http.ts';
export function finalsCronAuthorized(request:Request,secret:string|undefined){
 if(!secret||secret.length<32||secret.length>512)return false;
 const actual=Buffer.from(request.headers.get('authorization')??''),expected=Buffer.from(`Bearer ${secret}`);
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
/** One explicitly configured operator/scope, one due package, shared 60s cron.
 * 10s due + 10s claim + 10s work + bounded join/settlement/abort cleanup.
 * Absolute 30s DB cancellation prevents late heartbeats extending a lost owner.
 * Transform checkpoints survive; ZIP emission may need the longer operator route.
 * No new schedule or runtime is allocated. */
export async function runFinalsDispatch(env:Readonly<Record<string,string|undefined>>,factory:(i:FinalsIdentity)=>Promise<FinalsRuntime|null>){
 if(env.PHOTO_FINALS_DISPATCH_ENABLED!=='true')return {enabled:false,ok:true};
 try{
  const raw=env.PHOTO_FINALS_DISPATCH_SCOPE;if(!raw||raw.length>1024)throw new Error('config');
  const scope=JSON.parse(raw),actorId=env.PHOTO_FINALS_DISPATCH_ACTOR_ID;
  if(!actorId||!UUID.test(actorId)||!finalsExecutionAllowed(env,scope)||env.PHOTO_FINALS_ENVIRONMENT!=='production')throw new Error('config');
  const identity={scope,actorId,operator:true},runtime=await factory(identity);if(!runtime)throw new Error('config');
  const signal=AbortSignal.timeout(30_000),bounded=createFinalsApplicationDatabase(runtime.db);
  const db={rpc:async(name:string,args:Record<string,unknown>)=>{try{return {data:await packageRpc(bounded,name,args,signal),error:null};}catch{return {data:null,error:{message:'finals_dispatch_unconfirmed'}};}}};
  await packageRpc(db,'photo_finals_access',{p_org:scope.organizationId,p_actor:actorId,p_booking:scope.bookingId,p_property:scope.propertyId,p_operator:true},signal);
  const results=await dispatchFinalReleases({...runtime,db,scope,workerId:'production-shared-cron',budgets:{totalMs:10_000}});
  return {enabled:true,ok:true,processed:results.length};
 }catch{return {enabled:true,ok:false};}
}
