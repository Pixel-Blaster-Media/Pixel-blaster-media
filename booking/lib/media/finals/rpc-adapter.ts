import type {FinalsDatabase} from './ingest.ts';
import {packageRpc} from './package-runtime.ts';
export const FINALS_OPERATIONS=new Set([
 'reconcile_expired','recover_intent','inventory','download_begin','download_finish','download_revoke','access','current','upload_target','create_intent','claim','target','stage','fence','accept','fail','due',
 'resume_index','package_index_targets','transfer_begin','transfer_resume','transfer_status','chunk_begin','chunk_finish','package_finish_indexed',
 'prepare_release','approve_release','package_claim','package_heartbeat','package_checkpoint','package_finish','package_fail','package_due',
].map(name=>'photo_finals_'+name));
/** Narrow application adapter over a server-owned PostgREST-compatible client.
 * All calls, including ingest RPCs, receive the existing 10s transport deadline.
 * A lost response is unconfirmed, never synthesized success or automatic replay.
 * Post-parse response bounds do not certify the underlying deployed transport.
 */
export function createFinalsApplicationDatabase(client:FinalsDatabase):FinalsDatabase{
 return {rpc(name,args){
  let parent:AbortSignal|undefined;
  let pending:Promise<{data:unknown;error:unknown}>|undefined;
  const run=async()=>{try{
   if(!FINALS_OPERATIONS.has(name)||Buffer.byteLength(JSON.stringify(args))>(name==='photo_finals_package_finish_indexed'?2097152:262144))throw new Error('invalid');
   const data=await packageRpc(client,name,args,parent);
   if(Buffer.byteLength(JSON.stringify(data)??'null')>2*1024*1024)throw new Error('response');
   return {data,error:null};
  }catch{return {data:null,error:{message:'finals_operation_unconfirmed'}};}};
  return {abortSignal(signal:AbortSignal){parent=signal;return this;},then(onfulfilled,onrejected){pending??=run();return pending.then(onfulfilled,onrejected);}};
 }};
}
