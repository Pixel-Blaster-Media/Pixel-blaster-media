/** Finite retries spend fresh server attempts; no replay of a dispatch grant. */
import {TransferBudgetExhausted} from './recovery.ts';
export async function checkTransferBudget(response:Response){
 if(response.status!==429)return;
 const value=await metadataJson(response) as {status?:unknown;recovery?:unknown};
 if(value?.status==='budget-exhausted'&&value.recovery==='contact-support')throw new TransferBudgetExhausted();
 throw Error('transfer_unavailable');
}
const delay=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{signal.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});
export async function fetchChunk(url:string,signal:AbortSignal,deps:{fetch:typeof fetch;delay:typeof delay}={fetch:(input,init)=>fetch(input,init),delay}){
 for(let attempt=0;attempt<2;attempt++){
  signal.throwIfAborted();
  try{
   const r=await deps.fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(90000)])});
   await checkTransferBudget(r);
   if(attempt===1||![502,503,504].includes(r.status))return r;
   await r.body?.cancel();
  }catch(e){if(e instanceof TransferBudgetExhausted||attempt===1||signal.aborted)throw e;}
  await deps.delay(500,signal);
 }
 throw Error('retry_limit');
}
export async function metadataJson(response:Response):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw Error('metadata_empty');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const n=await reader.read();if(n.done)break;size+=n.value.length;if(size>1_000_000)throw Error('metadata_bound');chunks.push(n.value);}}
 finally{void reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
