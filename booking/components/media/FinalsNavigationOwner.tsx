'use client';
import {createContext,useCallback,useContext,useEffect,useRef,type ReactNode} from 'react';
type Register=(owner:symbol,dirty:boolean)=>void;
const DirtyContext=createContext<Register|null>(null);
/** Route owner retains dirty flags above the tab body. Capture runs before Next
 * Link's client router, including sidebar/property links outside this subtree. */
export default function FinalsNavigationOwner({children}:{children:ReactNode}){
 const drafts=useRef(new Set<symbol>()),leaving=useRef(false);
 const register=useCallback<Register>((owner,dirty)=>{if(dirty){drafts.current.add(owner);leaving.current=false;}else drafts.current.delete(owner);},[]);
 useEffect(()=>{
  const click=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!drafts.current.size)return;
   const target=event.target instanceof Element?event.target.closest('a[href]'):null;
   if(!(target instanceof HTMLAnchorElement)||target.download||target.target==='_blank')return;
   const url=new URL(target.href,location.href);
   if(url.href===location.href||url.pathname.startsWith('/api/'))return;
   if(!window.confirm('Leave this workspace? Unsaved photo selection and order will be discarded. Uploaded originals are retained.')){event.preventDefault();event.stopImmediatePropagation();return;}
   leaving.current=true;
  };
  const unload=(event:BeforeUnloadEvent)=>{if(drafts.current.size&&!leaving.current){event.preventDefault();event.returnValue='';}};
  document.addEventListener('click',click,true);window.addEventListener('beforeunload',unload);
  return()=>{document.removeEventListener('click',click,true);window.removeEventListener('beforeunload',unload);};
 },[]);
 return <DirtyContext.Provider value={register}>{children}</DirtyContext.Provider>;
}
export function useFinalsDirty(dirty:boolean){
 const register=useContext(DirtyContext),owner=useRef(Symbol('photo-draft'));
 useEffect(()=>{const key=owner.current;register?.(key,dirty);return()=>register?.(key,false);},[dirty,register]);
 // Isolated mounts retain native page-exit protection without a route owner.
 useEffect(()=>{if(register||!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,register]);
}
