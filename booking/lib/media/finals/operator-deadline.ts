import type {FinalsDatabase} from './ingest.ts';
import {packageRpc} from './package-runtime.ts';
/** Absolute invocation bounds remain active through heartbeat joins and fenced
 * settlement. A timed-out RPC is ambiguous; no automatic mutation replay. */
export function finalsDeadline(at:number){
 const controller=new AbortController();
 const check=(tailMs=0)=>{if(!Number.isFinite(at)||Date.now()+tailMs>=at)controller.abort(new Error('finals_operator_budget'));controller.signal.throwIfAborted();};
 const timer=setTimeout(()=>controller.abort(new Error('finals_operator_budget')),Math.max(1,at-Date.now()));
 async function wait<T>(fn:()=>Promise<T>):Promise<T>{
  check();let abort:()=>void=()=>{};
  try{
   const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});});
   const result=await Promise.race([fn(),cancelled]);check();return result;
  }finally{controller.signal.removeEventListener('abort',abort);}
 }
 return {signal:controller.signal,check,wait,close(){clearTimeout(timer);}};
}
export function deadlineDatabase(db:FinalsDatabase,signal:AbortSignal):FinalsDatabase{
 return {rpc(name,args){let parent=signal;let pending:Promise<{data:unknown;error:unknown}>|undefined;
  const run=async()=>{try{return {data:await packageRpc(db,name,args,parent),error:null};}catch{return {data:null,error:{message:'finals_deadline_unconfirmed'}};}};
  return {abortSignal(next:AbortSignal){parent=AbortSignal.any([signal,next]);return this;},then(yes,no){pending??=run();return pending.then(yes,no);}};
 }};
}
