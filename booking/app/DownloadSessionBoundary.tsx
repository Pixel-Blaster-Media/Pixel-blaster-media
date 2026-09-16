'use client';
import {useEffect,useState} from 'react';
import {watchDownloadSession} from '@/lib/media/resumable/lifecycle';
import {metadataJson} from '@/lib/media/resumable/network';

export default function DownloadSessionBoundary({enabled}:{enabled:boolean}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
  if(!navigator.locks||!navigator.storage?.getDirectory)return;
  try{if(!enabled&&!localStorage.getItem('pixel-resume-owner')&&!Object.keys(localStorage).some(k=>k.startsWith('pixel-resume:')))return;}catch{return;}
  return watchDownloadSession(async()=>{
   if(!enabled)return null;
   const r=await fetch('/api/photo-finals/session',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw Error('session_unavailable');
   const value=await metadataJson(r) as {identity?:unknown};
   if(value.identity!==null&&(typeof value.identity!=='string'||! /^[a-f0-9]{64}$/.test(value.identity)))throw Error('session_invalid');
   return value.identity as string|null;
  },15000,()=>setFailed(true));
 },[enabled]);
 return failed?<p role="alert" className="p-3 text-sm">Temporary download cleanup could not be confirmed. Close other Pixel download tabs and reload to retry. Already exported files are not removed.</p>:null;
}
