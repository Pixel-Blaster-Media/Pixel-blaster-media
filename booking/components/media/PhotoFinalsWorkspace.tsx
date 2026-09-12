'use client';
/* eslint-disable @next/next/no-img-element -- Private session-bound images must not enter a shared image optimizer/cache. */

import {useCallback,useEffect,useRef,useState} from 'react';
import {selectDeliverySources,type DeliverySourceCandidate} from '@/lib/booking/delivery-source-policy';

type State={status:'enabled';batchId:string|null;revision:number;release:{id:string;state:string;revision:number}|null;versions:{id:string;status:string;previewUrl:string|null;width:number|null;height:number|null}[];gallery:{releaseId:string;items:{id:string;url:string}[];downloads:DeliverySourceCandidate[]}|null};
type Receipt={id:string;revision:number;manifestSha256:string};
const button='min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50';
/** Keyed state prevents a booking switch from carrying another booking's draft. */
export default function PhotoFinalsWorkspace(props:{bookingId:string;operator?:boolean;incumbent?:DeliverySourceCandidate[]}){return <Workspace key={props.bookingId} {...props}/>;}
function Workspace({bookingId,operator=false,incumbent=[]}:{bookingId:string;operator?:boolean;incumbent?:DeliverySourceCandidate[]}){
 const endpoint='/api/photo-finals/'+bookingId;
 const [state,setState]=useState<State|null>(null),[selected,setSelected]=useState<string[]>([]),[receipt,setReceipt]=useState<Receipt|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('Checking private photo availability…'),[disabled,setDisabled]=useState(false);
 const requestId=useRef<string|null>(null),live=useRef(true);
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  const response=await fetch(endpoint,{cache:'no-store',signal});const value=await response.json();
  if(!live.current)return;
  if(!response.ok){setState(null);setReceipt(null);setDisabled(value.status==='disabled');throw new Error(value.message||'Photo availability could not be confirmed.');}
  if(value.status!=='enabled'||!Array.isArray(value.versions))throw new Error('Photo response could not be confirmed.');
  setState(value);setDisabled(false);setMessage(value.gallery?'Approved photos are ready.':'Photos remain private until approval and all packages are verified.');
 },[endpoint]);
 useEffect(()=>{live.current=true;const controller=new AbortController();void refresh(controller.signal).catch(e=>{if(live.current&&!controller.signal.aborted)setMessage(e.message);});return()=>{live.current=false;controller.abort();};},[refresh]);
 useEffect(()=>{if(!selected.length)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[selected.length]);
 async function post(body:unknown){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Operation could not be confirmed.');return data;}
 async function run(fn:()=>Promise<void>){setBusy(true);setReceipt(null);try{await fn();}catch{if(live.current){setState(null);setMessage('Photo finals could not be confirmed. Refresh before retrying; uploaded files may already be retained.');}}finally{if(live.current)setBusy(false);}}
 async function upload(files:FileList|null){if(!files?.length)return;
  const inputs=Array.from(files);if(inputs.length>32||inputs.some(f=>f.type!=='image/jpeg'||f.size<1||f.size>33554432)){setMessage('Choose up to 32 finished JPEGs, no larger than 32 MiB each.');return;}
  await run(async()=>{requestId.current??=crypto.randomUUID();
   for(const file of inputs){setMessage('Uploading and verifying '+file.name+'…');const bytes=await file.arrayBuffer();const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const intent=await post({op:'intent',requestId:requestId.current,intentId:crypto.randomUUID(),sha256,byteSize:file.size});
    const capability=new URL(intent.upload.url,location.origin);
    // Only an explicit server-issued capability is used; never accept a file URL.
    if(capability.origin!==location.origin||Date.parse(intent.upload.expiresAt)<=Date.now())throw new Error('Unsupported upload capability');
    const uploaded=await fetch(capability,{method:'PUT',headers:intent.upload.headers,body:bytes});if(!uploaded.ok)throw new Error('Upload was not confirmed');
    const accepted=await post({op:'complete',jobId:intent.jobId});if(accepted.status!=='accepted')throw new Error('Acceptance pending');
   }await refresh();});
 }
 function change(next:string[]){setSelected(next);setReceipt(null);}
 const downloads=selectDeliverySources([...incumbent,...(state?.gallery?.downloads??[])],{pixelFallbackEnabled:!!state?.gallery,pixelPackageSetComplete:!!state?.gallery});
 return <section aria-label={operator?'Finished photo finals':'Private photo gallery'} aria-busy={busy} className="min-w-0 space-y-4 rounded-md border border-slate-200 bg-white p-4 text-slate-900">
  <div><h2 className="text-lg font-semibold">{operator?'Finished photos':'Your approved photos'}</h2><p className="mt-1 text-sm text-slate-600">{operator?'Upload final JPEG exports from any editor. Lightroom is optional.':'Private gallery and downloads for this shoot.'} Valid iGUIDE downloads remain preferred per format.</p></div>
  <p role="status" className="break-words text-sm text-slate-600">{message}</p>
  {!disabled&&<button className={button} disabled={busy} onClick={()=>void run(()=>refresh())}>Refresh photo status</button>}
  {operator&&state&&<>
   <label className="block text-sm font-medium">Upload finished JPEGs<input aria-label="Upload finished JPEGs" className="mt-2 block min-h-11 w-full min-w-0 max-w-full text-sm" type="file" accept="image/jpeg,.jpg,.jpeg" multiple disabled={busy} onChange={e=>{void upload(e.target.files);e.target.value='';}}/></label>
   <p className="text-xs text-slate-600">Private originals retain EXIF. Approval confirms permission to share. MLS export is provisional; verify destination requirements.</p>
   {state.release&&<p className="text-sm">Release {state.release.revision}: <strong>{state.release.state}</strong></p>}
   <ol className="space-y-2" aria-label="Review uploaded photos">{state.versions.map((v,index)=><li key={v.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-slate-200 p-2">
    {v.previewUrl&&/* eslint-disable-next-line @next/next/no-img-element */<img src={v.previewUrl} alt={'Candidate photo '+(index+1)} className="h-20 w-28 rounded object-cover"/>}
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label={'Select photo '+(index+1)} checked={selected.includes(v.id)} disabled={busy||v.status!=='accepted'} onChange={()=>change(selected.includes(v.id)?selected.filter(x=>x!==v.id):[...selected,v.id])}/>Photo {index+1} · {v.status}</label>
    {selected.includes(v.id)&&<div className="flex items-center gap-2"><span className="text-xs">Position {selected.indexOf(v.id)+1}</span><button className={button} aria-label={'Move photo '+(index+1)+' earlier'} disabled={busy||selected.indexOf(v.id)===0} onClick={()=>{const next=[...selected],n=next.indexOf(v.id);[next[n-1],next[n]]=[next[n],next[n-1]];change(next);}}>Earlier</button></div>}
   </li>)}</ol>
   <div className="flex flex-wrap gap-2"><button className={button} disabled={busy||!selected.length} onClick={()=>void run(async()=>{const draft=await post({op:'prepare',batchId:state.batchId,releaseId:crypto.randomUUID(),expectedRevision:state.revision,versionIds:selected});await refresh();setReceipt(draft);setMessage('Review snapshot saved. Approve only if these selected photos and their order are final.');})}>Save review order</button>
   {receipt&&<button className={button+' border-blue-600 text-blue-700'} disabled={busy} onClick={()=>{const approved=receipt;void run(async()=>{const result=await post({op:'approve',releaseId:approved.id,revision:approved.revision,manifestSha256:approved.manifestSha256});if(result.status!=='packaging')throw new Error('Approval unconfirmed');setSelected([]);await refresh();});}}>Approve selected finals</button>}
   {state.release?.state==='packaging'&&<button className={button} disabled={busy} onClick={()=>void run(async()=>{await post({op:'work'});await refresh();})}>Prepare private packages</button>}</div>
  </>}
  {state?.gallery&&<div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Approved gallery">{state.gallery.items.map((item,index)=>/* eslint-disable-next-line @next/next/no-img-element */<img key={item.id} src={item.url} alt={'Approved photo '+(index+1)} className="h-auto w-full rounded-md"/>)}</div>}
  {!!downloads.length&&<div className="flex flex-wrap gap-2">{downloads.map(d=><a key={d.slot??d.url} href={d.url} className={button}>{d.label}</a>)}</div>}
 </section>;
}
