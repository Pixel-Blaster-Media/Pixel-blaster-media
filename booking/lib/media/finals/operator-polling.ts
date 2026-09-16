/** Read-only, one request at a time. Stopping this observer never cancels the
 * database-backed approved job. Visibility pauses do not reset its finite budget. */
export function startFinalsPolling(o:{visibility:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>;read:(signal:AbortSignal)=>Promise<boolean>;onStop:(reason:'terminal'|'budget'|'unavailable')=>void;initialMs?:number;maxMs?:number;budgetMs?:number}){
 let stopped=false,pending=false,delay=o.initialMs??2000,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
 const max=o.maxMs??10000;
 const budget=setTimeout(()=>finish('budget'),o.budgetMs??300000);
 function clear(){clearTimeout(timer);timer=undefined;}
 function finish(reason:'terminal'|'budget'|'unavailable'){if(stopped)return;stop();o.onStop(reason);}
 function schedule(){clear();if(!stopped&&!pending&&!o.visibility.hidden)timer=setTimeout(()=>{void poll();},delay);}
 async function poll(){
  if(stopped||pending||o.visibility.hidden)return;
  pending=true;const current=new AbortController();controller=current;
  const timeout=setTimeout(()=>current.abort(),15000);
  try{const more=await o.read(current.signal);if(!stopped&&!current.signal.aborted&&!more)finish('terminal');}
  catch{if(!stopped&&!current.signal.aborted)finish('unavailable');}
  finally{clearTimeout(timeout);pending=false;if(!stopped){delay=Math.min(max,Math.ceil(delay*1.5));schedule();}}
 }
 function visibility(){clear();if(o.visibility.hidden)controller?.abort();else schedule();}
 function stop(){stopped=true;clear();clearTimeout(budget);controller?.abort();o.visibility.removeEventListener('visibilitychange',visibility);}
 o.visibility.addEventListener('visibilitychange',visibility);schedule();return stop;
}
