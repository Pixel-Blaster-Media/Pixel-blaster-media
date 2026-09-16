import {digest,incrementalHash} from './integrity.ts';
export type Metadata={transferId:string;packageId:string;packageSha256:string;indexSha256:string;byteSize:number;chunkSize:number;chunkCount:number;chunkDigests:string[];expiresAt?:string};
export type Disk={getSize():number;read(b:Uint8Array,o:{at:number}):number;write(b:Uint8Array,o:{at:number}):number;truncate(n:number):void;flush():void};
export type Progress={state:string;bytes:number;resumedAt?:number;sha256?:string;error?:string};
export async function transfer(m:Metadata,disk:Disk,getChunk:(index:number)=>Promise<Response>,signal:AbortSignal,report:(p:Progress)=>void){
 const whole=incrementalHash();let offset=0,next=0;
 report({state:'verifying',bytes:0});
 for(let i=0;i<m.chunkCount;i++){
  signal.throwIfAborted();const n=Math.min(m.chunkSize,m.byteSize-offset);if(offset+n>disk.getSize())break;
  const b=new Uint8Array(n);if(disk.read(b,{at:offset})!==n||await digest(b)!==m.chunkDigests[i])break;
  whole.update(b);offset+=n;next++;
 }
 disk.truncate(offset);disk.flush();const resumedAt=offset;
 for(let i=next;i<m.chunkCount;i++){
  signal.throwIfAborted();const n=Math.min(m.chunkSize,m.byteSize-offset),r=await getChunk(i);
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   if(r.status!==206||r.headers.get('Content-Range')!==`bytes ${offset}-${offset+n-1}/${m.byteSize}`||r.headers.get('Content-Length')!==String(n)||r.headers.get('ETag')!==`"${m.packageSha256}"`||r.headers.get('X-Chunk-Sha256')!==m.chunkDigests[i]||!r.body)throw Error('range_protocol');
   reader=r.body.getReader();const b=new Uint8Array(n);let used=0;
   while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;if(used+part.value.length>n)throw Error('range_overflow');b.set(part.value,used);used+=part.value.length;}
   if(used!==n||await digest(b)!==m.chunkDigests[i])throw Error('chunk_integrity');
   signal.throwIfAborted();if(disk.write(b,{at:offset})!==n)throw Error('short_disk_write');disk.flush();whole.update(b);offset+=n;
   report({state:'downloading',bytes:offset,resumedAt});
  }finally{if(reader)await reader.cancel();else await r.body?.cancel();}
 }
 report({state:'verifying',bytes:offset,resumedAt});const sha256=await whole.hex();
 if(offset!==m.byteSize||sha256!==m.packageSha256){disk.truncate(0);disk.flush();throw Error('package_integrity');}
 return {state:'ready',bytes:offset,resumedAt,sha256};
}
