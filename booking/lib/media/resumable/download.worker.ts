import {fetchChunk} from './network';
import {DOWNLOAD_LOCK,readDownloadEpoch,onDownloadCleanup} from './lifecycle';
import {recoveryProgress} from './recovery';
import {validateMetadata} from './metadata';
import {transfer,type Metadata,type Disk} from './transfer';
type SyncDisk=Disk&{close():void};
type SyncFile=FileSystemFileHandle&{createSyncAccessHandle():Promise<SyncDisk>};
const worker=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage(value:unknown):void};
let active:AbortController|null=null;
onDownloadCleanup(()=>active?.abort());
worker.onmessage=({data})=>{
 if(data.op==='pause'){active?.abort();return;}
 if(data.op!=='start'||active)return;
 const controller=new AbortController();active=controller;
 void navigator.locks.request(DOWNLOAD_LOCK,{mode:'shared'},async()=>{
  controller.signal.throwIfAborted();
  if(typeof data.epoch!=='string'||!data.epoch||await readDownloadEpoch()!==data.epoch)throw Error('identity_changed');
  return navigator.locks.request('pixel-resume:'+data.metadata.indexSha256,{ifAvailable:true},async lock=>{
  if(!lock){worker.postMessage({state:'busy',error:'Another tab is downloading this package.'});return;}
  await run(data.metadata,data.endpoint,controller);
 });}).catch(error=>worker.postMessage(recoveryProgress(error))).finally(()=>{active=null;});
};
async function run(m:Metadata,endpoint:string,controller:AbortController){
 let disk:SyncDisk|undefined;
 try{
  validateMetadata(m);
  const root=await navigator.storage.getDirectory();
  const file=await root.getFileHandle('pixel-resume-'+m.indexSha256+'.zip',{create:true}) as SyncFile;
  disk=await file.createSyncAccessHandle();
  const result=await transfer(m,disk,index=>fetchChunk(`${endpoint}?transferId=${encodeURIComponent(m.transferId)}&index=${index}`,controller.signal),controller.signal,p=>worker.postMessage(p));
  disk.close();disk=undefined;worker.postMessage(result);
 }catch(error){worker.postMessage(controller.signal.aborted?{state:'paused',bytes:0}:recoveryProgress(error));}
 finally{disk?.close();}
}
