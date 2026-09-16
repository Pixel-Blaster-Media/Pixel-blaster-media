import {metadataJson} from './network';
import {samePackage,validateMetadata} from './metadata';
import type {Metadata,Progress} from './transfer';
type Options={endpoint:string;identity:string;packageId?:string;packageType:'originals'|'web';worker:()=>Worker;report:(p:Progress)=>void};
/** Checkpoints are hints only: every start POST authorizes; worker rehashes disk. */
export class DownloadController{
 private metadata:Metadata|null=null;private worker:Worker|null=null;private generation=0;private pending:AbortController|null=null;private state='idle';private objectUrl:string|null=null;
 private visibility=()=>{if(document.hidden)this.pause();};
 constructor(private options:Options){document.addEventListener('visibilitychange',this.visibility);}
 dispose(){this.pause();document.removeEventListener('visibilitychange',this.visibility);if(this.objectUrl)URL.revokeObjectURL(this.objectUrl);}
 async changeIdentity(identity:string){if(identity!==this.options.identity){await this.discard();this.options.identity=identity;}}
 private key(){return 'pixel-resume:'+this.options.identity+':'+this.options.endpoint+':'+(this.options.packageId??this.options.packageType);}
 private report(p:Progress){this.state=p.state;this.options.report(p);}
 private async metadataRequest(init:RequestInit,query=''){
  const response=await fetch(this.options.endpoint+query,{...init,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.any([this.pending?.signal??new AbortController().signal,AbortSignal.timeout(15000)])});
  if(!response.ok)throw Error(response.status===403?'Current access denied. Refresh photo status.':'Download authority unavailable. Retry or contact support.');
   return validateMetadata(await metadataJson(response));
 }
 async start(){
  this.pause();const generation=++this.generation;this.pending=new AbortController();this.report({state:'authorizing',bytes:0});
  try{
   if(typeof Worker==='undefined'||!navigator.locks||!navigator.storage?.getDirectory||!navigator.storage.estimate){this.report({state:'unsupported',bytes:0,error:'This browser cannot safely prepare this ZIP. No fallback download was started.'});return;}
   const saved=localStorage.getItem(this.key());
   const m=await this.metadataRequest({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(saved?{op:'resume',transferId:saved}:this.options.packageId?{op:'begin',packageId:this.options.packageId}:{op:'begin',packageType:this.options.packageType})});
   if(generation!==this.generation)return;this.metadata=m;localStorage.setItem(this.key(),m.transferId);
   const estimate=await navigator.storage.estimate();
   if(estimate.quota!==undefined&&estimate.usage!==undefined&&estimate.quota-estimate.usage<m.byteSize){this.report({state:'quota',bytes:0,error:'Not enough temporary browser storage. Free space, then retry.'});return;}
   if(generation!==this.generation)return;
   const worker=this.options.worker();this.worker=worker;
   worker.onmessage=({data:p})=>{if(generation!==this.generation)return;this.report(p);if(['ready','paused','busy','error','quota','unsupported'].includes(p.state)){worker.terminate();if(this.worker===worker)this.worker=null;}};
   worker.onerror=()=>{if(generation===this.generation)this.report({state:'error',bytes:0,error:'Download worker failed. Retry to recheck saved progress.'});worker.terminate();};
   worker.postMessage({op:'start',metadata:m,endpoint:this.options.endpoint});
  }catch(error){if(generation===this.generation)this.report({state:'error',bytes:0,error:error instanceof Error?error.message:'download_failed'});}
 }
 pause(){++this.generation;this.pending?.abort();this.pending=null;this.worker?.postMessage({op:'pause'});this.worker?.terminate();this.worker=null;this.report({state:'paused',bytes:0});}
 async save(){
  if(this.state!=='ready'||!this.metadata)return;
  const generation=this.generation,m=this.metadata;this.pending=new AbortController();this.report({state:'authorizing',bytes:m.byteSize});
  try{
   // Hold the same lock as the writer through native handoff; no in-memory ZIP.
   await navigator.locks.request('pixel-resume:'+m.indexSha256,{ifAvailable:true},async lock=>{
    if(!lock)throw Error('Another tab is using this package.');
    const root=await navigator.storage.getDirectory(),handle=await root.getFileHandle('pixel-resume-'+m.indexSha256+'.zip'),file=await handle.getFile();
    if(file.size!==m.byteSize)throw Error('Local package changed. Resume verification.');
    const fresh=await this.metadataRequest({method:'GET'},'?transferId='+encodeURIComponent(m.transferId));
    if(generation!==this.generation)return;
    if(fresh.transferId!==m.transferId||!samePackage(m,fresh))throw Error('Package authority changed. Refresh photo status.');
    if(this.objectUrl)URL.revokeObjectURL(this.objectUrl);this.objectUrl=URL.createObjectURL(file);
    const a=document.createElement('a');a.href=this.objectUrl;a.download='approved-'+this.options.packageType+'.zip';document.body.append(a);a.click();a.remove();
    this.report({state:'save-initiated',bytes:m.byteSize});
   });
  }catch(error){if(generation===this.generation)this.report({state:'error',bytes:m.byteSize,error:error instanceof Error?error.message:'save_failed'});}
 }
 async discard(){
  this.pause();if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=null;}const m=this.metadata;localStorage.removeItem(this.key());
  if(m)await navigator.locks.request('pixel-resume:'+m.indexSha256,async()=>{const root=await navigator.storage.getDirectory();try{await root.removeEntry('pixel-resume-'+m.indexSha256+'.zip');}catch(e){if(!(e instanceof DOMException&&e.name==='NotFoundError'))throw e;}});
  this.metadata=null;this.report({state:'idle',bytes:0});
 }
}
