'use client';
/* eslint-disable @next/next/no-img-element -- Session-bound private images bypass shared optimization. */
import {useEffect,useRef,useState} from 'react';

type Item={id:string;url:string};
const control='min-h-11 min-w-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600';
export default function FinalsGallery({items}:{items:Item[]}){
 const [active,setActive]=useState<number|null>(null);
 return <div aria-label="Approved gallery" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
  {items.map((item,index)=><button key={item.id} type="button" aria-label={'Enlarge photo '+(index+1)} onClick={()=>setActive(index)} className="min-h-11 min-w-11 overflow-hidden rounded-md border border-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><img src={item.url} alt={'Approved photo '+(index+1)} className="aspect-[4/3] w-full object-cover" loading="lazy"/></button>)}
  {active!==null&&<Preview items={items} initial={active} close={()=>setActive(null)}/>}
 </div>;
}
function Preview({items,initial,close}:{items:Item[];initial:number;close:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [index,setIndex]=useState(initial);
 useEffect(()=>{
  const node=dialog.current!,opener=document.activeElement as HTMLElement|null;
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden';node.showModal();
  return()=>{node.close();document.body.style.overflow=overflow;if(opener?.isConnected)opener.focus();};
 },[]);
 const move=(n:number)=>setIndex((n+items.length)%items.length);
 return <dialog ref={dialog} aria-label="Photo preview" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}} onKeyDown={e=>{
  if(e.key==='Tab'){
   const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')).filter(b=>b.getClientRects().length);
   const first=buttons[0],last=buttons[buttons.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
  if(e.key==='ArrowRight'){e.preventDefault();move(index+1);}else if(e.key==='ArrowLeft'){e.preventDefault();move(index-1);}else if(e.key==='Home'){e.preventDefault();setIndex(0);}else if(e.key==='End'){e.preventDefault();setIndex(items.length-1);}
 }} className="m-auto w-[min(100%,1100px)] max-w-full overflow-hidden rounded-md border border-slate-300 bg-slate-50 text-slate-900 backdrop:bg-slate-950/70" style={{maxHeight:'100dvh',padding:'max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))'}}>
  <div className="flex min-h-0 flex-col gap-3" style={{maxHeight:'calc(100dvh - 48px - env(safe-area-inset-top) - env(safe-area-inset-bottom))'}}>
   <header className="flex shrink-0 items-center justify-between gap-2"><p aria-live="polite" className="text-sm">Photo {index+1} of {items.length}</p><button autoFocus className={control} onClick={close}>Close preview</button></header>
   <img src={items[index].url} alt={'Approved photo '+(index+1)} className="min-h-0 w-full flex-1 object-contain" style={{maxHeight:'calc(100dvh - 230px - env(safe-area-inset-top) - env(safe-area-inset-bottom))'}}/>
   <nav aria-label="Photo controls" className="flex shrink-0 justify-between gap-2"><button className={control} onClick={()=>move(index-1)}>Previous photo</button><button className={control} onClick={()=>move(index+1)}>Next photo</button></nav>
   <div aria-label="Photo thumbnails" className="flex shrink-0 gap-2 overflow-x-auto">{items.map((item,n)=><button key={item.id} aria-label={'Preview photo '+(n+1)} aria-pressed={n===index} onClick={()=>setIndex(n)} className={'min-h-11 min-w-11 shrink-0 overflow-hidden rounded border-2 '+(n===index?'border-blue-600':'border-transparent')}><img src={item.url} alt="" className="h-11 w-16 object-cover"/></button>)}</div>
  </div>
 </dialog>;
}
