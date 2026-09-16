import {createHash} from 'node:crypto';
export const PACKAGE_CHUNK_SIZE=131_072;
export const PACKAGE_MAX_BYTES=1_100_000_000;
export type ChunkIndexBinding={organization_id:string;package_id:string;release_id:string;manifest_sha256:string};
export type PackageChunkIndex=ChunkIndexBinding & {version:number;package_sha256:string;byte_size:number;chunk_size:number;chunk_count:number;digests:string;index_sha256:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha=/^[0-9a-f]{64}$/;
export function encodeChunkIndex(i:PackageChunkIndex):Buffer {
 if(i.version!==1||i.chunk_size!==PACKAGE_CHUNK_SIZE||!Number.isSafeInteger(i.byte_size)||i.byte_size<1||i.byte_size>PACKAGE_MAX_BYTES||i.chunk_count!==Math.ceil(i.byte_size/PACKAGE_CHUNK_SIZE)||![i.organization_id,i.package_id,i.release_id].every(x=>uuid.test(x))||![i.manifest_sha256,i.package_sha256].every(x=>sha.test(x))||typeof i.digests!=='string'||i.digests.length!==i.chunk_count*64||!/^[0-9a-f]+$/.test(i.digests))throw new Error('finals_index_invalid');
 const numbers=Buffer.alloc(16);numbers.writeBigUInt64BE(BigInt(i.byte_size));numbers.writeUInt32BE(i.chunk_size,8);numbers.writeUInt32BE(i.chunk_count,12);
 return Buffer.concat([Buffer.from('PFCHIDX1'),...[i.organization_id,i.package_id,i.release_id].map(x=>Buffer.from(x.replaceAll('-',''),'hex')),Buffer.from(i.manifest_sha256,'hex'),Buffer.from(i.package_sha256,'hex'),numbers,Buffer.from(i.digests,'hex')]);
}
export function verifyChunkIndex(i:PackageChunkIndex):true {if(!sha.test(i.index_sha256)||createHash('sha256').update(encodeChunkIndex(i)).digest('hex')!==i.index_sha256)throw new Error('finals_index_digest');return true;}
export function makeChunkIndex(binding:ChunkIndexBinding,result:ChunkDigestResult):PackageChunkIndex {
 const i={...binding,version:1,package_sha256:result.sha256,byte_size:result.bytes,chunk_size:PACKAGE_CHUNK_SIZE,chunk_count:Math.ceil(result.bytes/PACKAGE_CHUNK_SIZE),digests:result.digests,index_sha256:''};
 i.index_sha256=createHash('sha256').update(encodeChunkIndex(i)).digest('hex');return i;
}
export type ChunkDigestResult={bytes:number;sha256:string;digests:string};
/** Fixed hash state plus <=268576 digest bytes. Never retains package payload. */
export class ChunkIndexHasher {
 private whole=createHash('sha256');private chunk=createHash('sha256');private used=0;private bytes=0;private digests:Buffer[]=[];private ended=false;
 update(bytes:Uint8Array){
  if(this.ended||this.bytes+bytes.byteLength>PACKAGE_MAX_BYTES)throw new Error('finals_index_bound');
  this.bytes+=bytes.byteLength;this.whole.update(bytes);
  for(let at=0;at<bytes.byteLength;){const n=Math.min(PACKAGE_CHUNK_SIZE-this.used,bytes.byteLength-at);this.chunk.update(bytes.subarray(at,at+n));at+=n;this.used+=n;
   if(this.used===PACKAGE_CHUNK_SIZE){this.digests.push(this.chunk.digest());this.chunk=createHash('sha256');this.used=0;}}
 }
 finish():ChunkDigestResult {if(this.ended||!this.bytes)throw new Error('finals_index_bound');this.ended=true;if(this.used)this.digests.push(this.chunk.digest());return {bytes:this.bytes,sha256:this.whole.digest('hex'),digests:Buffer.concat(this.digests).toString('hex')};}
}
