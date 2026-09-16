'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,type ReactNode} from 'react';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
type Register=(owner:symbol,dirty:boolean)=>void;
const DirtyContext=createContext<Register|null>(null);
/** Route owner retains dirty flags above the tab body. Capture runs before Next
 * Link's client router, including sidebar/property links outside this subtree. */
export default function FinalsNavigationOwner({children}:{children:ReactNode}){
 const drafts=useRef(new Set<symbol>()),leaving=useRef(false);
 const register=useCallback<Register>((owner,dirty)=>{if(dirty){drafts.current.add(owner);leaving.current=false;}else drafts.current.delete(owner);},[]);
 const router=useContext(AppRouterContext);
 const allow=useCallback(()=>{if(leaving.current||!drafts.current.size)return true;const accepted=window.confirm('Leave this workspace? Unsaved photo selection and order will be discarded. Uploaded originals are retained.');if(accepted)leaving.current=true;return accepted;},[]);
 const guarded=useMemo(()=>router?{...router,push:(...args:Parameters<typeof router.push>)=>{if(allow())router.push(...args);},replace:(...args:Parameters<typeof router.replace>)=>{if(allow())router.replace(...args);}}:null,[router,allow]);
 useEffect(()=>{
  // Retain Next's history state; only add a local traversal index. Cancelled
  // traversal is reversed before the App Router's bubble popstate listener.
  const push=history.pushState,replace=history.replaceState;
  let index=Number(history.state?.__pfIndex??0),restoring=false,lastUrl=location.href,lastState=history.state;
  const remember=()=>{lastUrl=location.href;lastState=history.state;};
  replace.call(history,{...history.state,__pfIndex:index},'');remember();
  history.pushState=function(data,unused,url){index++;push.call(this,{...data,__pfIndex:index},unused,url);remember();};
  history.replaceState=function(data,unused,url){replace.call(this,{...data,__pfIndex:index},unused,url);remember();};
  const pop=(event:PopStateEvent)=>{if(restoring){restoring=false;event.stopImmediatePropagation();return;}const next=Number(event.state?.__pfIndex);if(!drafts.current.size||allow()){if(Number.isFinite(next))index=next;remember();return;}event.stopImmediatePropagation();if(Number.isFinite(next)&&next!==index){restoring=true;history.go(index-next);}else{replace.call(history,lastState,'',lastUrl);}};
  window.addEventListener('popstate',pop,true);
  return()=>{history.pushState=push;history.replaceState=replace;window.removeEventListener('popstate',pop,true);};
 },[allow]);
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
 return <DirtyContext.Provider value={register}>{guarded?<AppRouterContext.Provider value={guarded}>{children}</AppRouterContext.Provider>:children}</DirtyContext.Provider>;
}
export function useFinalsDirty(dirty:boolean){
 const register=useContext(DirtyContext),owner=useRef(Symbol('photo-draft'));
 useEffect(()=>{const key=owner.current;register?.(key,dirty);return()=>register?.(key,false);},[dirty,register]);
 // Isolated mounts retain native page-exit protection without a route owner.
 useEffect(()=>{if(register||!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,register]);
}
