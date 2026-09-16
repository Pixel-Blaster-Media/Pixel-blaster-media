import type {FinalsDatabase} from './ingest.ts';

export class ResumeBudgetExhausted extends Error {}

/** Abort PostgREST transport when supported, and bound even non-cancellable local
 * adapters. A timeout is ambiguous, never a claim that SQL rolled back. Exact
 * job leases/checkpoints fence late SQL and make the next claim recoverable.
 */
export async function packageRpc(db:FinalsDatabase,name:string,args:Record<string,unknown>,parent?:AbortSignal,timeoutMs=10_000){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(new Error('finals_package_rpc_timeout')),timeoutMs);
 const signal=parent?AbortSignal.any([parent,controller.signal]):controller.signal;
 let onAbort:()=>void=()=>{};
 try{
  signal.throwIfAborted();
  const request=db.rpc(name,args);
  const result='abortSignal' in request && typeof request.abortSignal==='function'?request.abortSignal(signal):request;
  const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();});
  const r=await Promise.race([Promise.resolve(result),aborted]);
  if(r.error){
   const e=r.error as {code?:unknown;message?:unknown};
   // These SQL branches execute only after locked current authority checks.
   if(e.code==='54000'&&((name==='photo_finals_transfer_begin'&&e.message==='finals_transfer_limit')||(name==='photo_finals_chunk_begin'&&e.message==='finals_attempt_budget')))throw new ResumeBudgetExhausted();
   throw new Error(`finals_package_rpc_failed:${name}`);
  }return r.data as unknown;
 }finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
}

/** One non-overlapping renewal loop, independent of slow storage/decoder awaits.
 * Cancellation of a failed heartbeat aborts ongoing storage. stop waits for any
 * in-flight (itself bounded) renewal before atomic finish/settlement.
 */
export function packageLease(renew:()=>Promise<unknown>,budgets:{totalMs?:number;heartbeatMs?:number}={}){
 const totalMs=budgets.totalMs??900_000,heartbeatMs=budgets.heartbeatMs??30_000;
 if(!Number.isSafeInteger(totalMs)||totalMs<1||totalMs>900_000||!Number.isSafeInteger(heartbeatMs)||heartbeatMs<1||heartbeatMs>30_000)throw new Error('finals_budget_invalid');
 const controller=new AbortController();let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
 let pending:Promise<void>=Promise.resolve();
 const deadline=setTimeout(()=>controller.abort(new Error('finals_package_budget_exhausted')),totalMs);
 function schedule(){if(!stopped&&!controller.signal.aborted)timer=setTimeout(()=>{
  pending=(async()=>{try{await renew();}catch(e){controller.abort(e);}finally{schedule();}})();
 },heartbeatMs);}
 schedule();
 return {signal:controller.signal,async stop(){stopped=true;clearTimeout(timer);clearTimeout(deadline);await pending;}};
}
