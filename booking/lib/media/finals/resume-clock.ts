/** One absolute clock per phase, joined to request cancellation. Ignored signals
 * cannot prolong waits; expired mutation outcomes remain ambiguous, never replayed. */
export function resumeClock(at:number,parent:AbortSignal){
 const c=new AbortController(),signal=AbortSignal.any([parent,c.signal]);
 const check=()=>{if(Date.now()>=at)c.abort(Error('resume_deadline'));signal.throwIfAborted();};
 const timer=setTimeout(()=>c.abort(Error('resume_deadline')),Math.max(1,at-Date.now()));
 async function wait<T>(run:()=>PromiseLike<T>):Promise<T>{check();let abort=()=>{};try{const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});const result=await Promise.race([Promise.resolve().then(()=>{check();return run();}),stopped]);check();return result;}finally{signal.removeEventListener('abort',abort);}}
 return {signal,check,wait,close(){clearTimeout(timer);c.abort(Error('resume_phase_closed'));}};
}
