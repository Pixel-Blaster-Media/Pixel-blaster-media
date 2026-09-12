import type {FinalsDatabase} from './ingest.ts';
import {packageRpc} from './package-runtime.ts';
const OPERATIONS=new Set([
 'access','current','upload_target','create_intent','claim','target','stage','fence','accept','fail','due',
 'prepare_release','approve_release','package_claim','package_heartbeat','package_checkpoint','package_finish','package_fail','package_due',
].map(name=>'photo_finals_'+name));
/** Narrow application adapter over a server-owned PostgREST-compatible client.
 * All calls, including ingest RPCs, receive the existing 10s transport deadline.
 * A lost response is unconfirmed, never synthesized success or automatic replay.
 * Post-parse response bounds do not certify the underlying deployed transport.
 */
export function createFinalsApplicationDatabase(client:FinalsDatabase):FinalsDatabase{
 return {async rpc(name,args){
  try{
   if(!OPERATIONS.has(name)||Buffer.byteLength(JSON.stringify(args))>262144)throw new Error('invalid');
   const data=await packageRpc(client,name,args);
   if(Buffer.byteLength(JSON.stringify(data)??'null')>2*1024*1024)throw new Error('response');
   return {data,error:null};
  }catch{return {data:null,error:{message:'finals_operation_unconfirmed'}};}
 }};
}
