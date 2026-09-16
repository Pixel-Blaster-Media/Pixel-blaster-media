'use client';
import {useEffect,useRef,useState} from 'react';
import {DownloadController} from '../../lib/media/resumable/controller';
import type {Progress} from '../../lib/media/resumable/transfer';
type Props={endpoint:string;identity:string;packageId:string;packageType:'originals'|'web';label:string};
const button='min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50';
export default function ResumableDownload({endpoint,identity,packageId,packageType,label}:Props){
 const controller=useRef<DownloadController|null>(null),[progress,setProgress]=useState<Progress>({state:'idle',bytes:0});
 useEffect(()=>{
  const c=new DownloadController({endpoint,identity,packageId,packageType,worker:()=>new Worker(new URL('../../lib/media/resumable/download.worker.ts',import.meta.url)),report:setProgress});
  controller.current=c;
  return()=>{c.dispose();controller.current=null;};
 },[endpoint,identity,packageId,packageType]);
 const working=['authorizing','verifying','downloading'].includes(progress.state);
 const text:Record<string,string>={'budget-exhausted':'Transfer safety limit reached','session-changed':'Session changed — reload this page',idle:'Ready to prepare',authorizing:'Checking current access',verifying:'Verifying local bytes',downloading:'Downloading',paused:'Paused — resume to recheck progress',ready:'Verified and ready to save','save-initiated':'Save initiated — check your browser or Files; saving is not confirmed',busy:'Another tab is using this package',quota:'Temporary storage unavailable',unsupported:'Safe download unsupported',error:'Download paused by an error'};
 return <div className="min-w-0 space-y-2 rounded-md border border-slate-200 p-3" aria-label={label}>
  <p className="text-sm font-medium">{label}</p>
  <p role="status" className="break-words text-sm text-slate-600">{text[progress.state]??progress.state}{progress.bytes>0?` · ${progress.bytes.toLocaleString()} verified bytes`:''}{progress.error?` · ${progress.error}`:''}</p>
  <div className="flex flex-wrap gap-2">
   {progress.state==='session-changed'?<button className={button} onClick={()=>window.location.reload()}>Reload page</button>:progress.state==='budget-exhausted'?<a className={button} href="mailto:info@pixelblastermedia.com">Contact support</a>:working?<button className={button} onClick={()=>controller.current?.pause()}>Pause</button>:progress.state==='ready'?<button className={button} onClick={()=>void controller.current?.save()}>Save ZIP</button>:<button className={button} onClick={()=>void controller.current?.start()}>{progress.state==='idle'?'Prepare ZIP':'Resume / verify ZIP'}</button>}
   <button className={button} onClick={()=>void controller.current?.discard().catch(()=>setProgress({state:'error',bytes:0,error:'Could not clear local progress. Close other download tabs and retry.'}))}>Discard local progress</button>
  </div>
  <p className="text-xs text-slate-600">Uses temporary storage plus space for the saved ZIP. Keep this page in the foreground. Leaving pauses work; Resume rechecks stored bytes. No automatic fallback download.</p>
 </div>;
}
