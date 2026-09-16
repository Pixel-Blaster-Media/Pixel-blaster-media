// Origin-wide fence. The empty epoch marker contains no user data or payload.
export const DOWNLOAD_LOCK='pixel-resume-lifecycle';
const CHANNEL='pixel-resume-cleanup';
const EPOCH='pixel-resume-epoch-';
const stops=new Set<()=>void>();
let channel:BroadcastChannel|undefined;
function listen(){
 if(!channel&&typeof BroadcastChannel!=='undefined'){
  channel=new BroadcastChannel(CHANNEL);
  channel.onmessage=()=>{for(const stop of stops)stop();};
 }
}
export function onDownloadCleanup(stop:()=>void){listen();stops.add(stop);return()=>{stops.delete(stop);if(!stops.size){channel?.close();channel=undefined;}};}
export async function readDownloadEpoch(){
 const root=await navigator.storage.getDirectory();
 const entries=root as FileSystemDirectoryHandle&{keys():AsyncIterableIterator<string>};
 let epoch='';
 for await(const name of entries.keys())if(name.startsWith(EPOCH)){if(epoch)throw Error('ambiguous_epoch');epoch=name;}
 return epoch;
}
export async function captureDownloadEpoch(){
 const existing=await navigator.locks.request(DOWNLOAD_LOCK,{mode:'shared'},readDownloadEpoch);if(existing)return existing;
 return navigator.locks.request(DOWNLOAD_LOCK,async()=>{
  const epoch=await readDownloadEpoch();if(epoch)return epoch;
  const name=EPOCH+crypto.randomUUID();await(await navigator.storage.getDirectory()).getFileHandle(name,{create:true});return name;
 });
}
export function watchDownloadSession(identity:()=>Promise<string|null>,intervalMs=15000,onError:()=>void=()=>{}){
 let stopped=false,running=false;
 const check=async()=>{
  if(stopped||running)return;running=true;
  try{
   const owner=(await identity())??'signed-out';if(stopped)return;
   if(localStorage.getItem('pixel-resume-owner')===null){
    const initialized=await navigator.locks.request(DOWNLOAD_LOCK,{signal:AbortSignal.timeout(15000)},async()=>{
     if(localStorage.getItem('pixel-resume-owner')!==null)return false;
     if(Object.keys(localStorage).some(k=>k.startsWith('pixel-resume:')))return false;
     const root=await navigator.storage.getDirectory() as FileSystemDirectoryHandle&{keys():AsyncIterableIterator<string>};
     for await(const key of root.keys())if(/^pixel-resume-[a-f0-9]{64}\.zip$/.test(key))return false;
     localStorage.setItem('pixel-resume-owner',owner);return true;
    });
    if(initialized)return;
   }
   if(localStorage.getItem('pixel-resume-owner')!==owner){await clearRetainedDownloads();if(!stopped)localStorage.setItem('pixel-resume-owner',owner);}
  }catch{for(const stop of stops)stop();onError();}finally{running=false;}
 };
 const timer=setInterval(()=>void check(),intervalMs);
 const focus=()=>void check();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
 const submitted=new WeakSet<HTMLFormElement>();
 const logout=(event:Event)=>{
  const form=event.target;if(!(form instanceof HTMLFormElement)||!form.hasAttribute('data-pixel-logout')||submitted.has(form))return;
  event.preventDefault();event.stopImmediatePropagation();
  void clearRetainedDownloads().then(()=>{localStorage.setItem('pixel-resume-owner','signed-out');}).catch(onError).finally(()=>{submitted.add(form);form.requestSubmit();});
 };
 document.addEventListener('submit',logout,true);void check();
 return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);document.removeEventListener('submit',logout,true);};
}

export async function clearRetainedDownloads(){
 listen();for(const stop of stops)stop();channel?.postMessage('clear');
 // Queue behind all writers/exports. Cancellation is advisory; this lock is the
 // deletion barrier. A queued stale worker must also validate its epoch.
 await navigator.locks.request(DOWNLOAD_LOCK,{signal:AbortSignal.timeout(15000)},async()=>{
  const root=await navigator.storage.getDirectory();
  const entries=root as FileSystemDirectoryHandle&{keys():AsyncIterableIterator<string>};
  for await(const name of entries.keys())if(/^pixel-resume-[a-f0-9]{64}\.zip$/.test(name)||name.startsWith(EPOCH))await root.removeEntry(name);
  await root.getFileHandle(EPOCH+crypto.randomUUID(),{create:true});
  for(const key of Object.keys(localStorage))if(key.startsWith('pixel-resume:'))localStorage.removeItem(key);
 });
}
