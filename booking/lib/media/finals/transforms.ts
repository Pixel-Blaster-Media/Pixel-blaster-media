import sharp from 'sharp';
import { open, type FileHandle } from 'node:fs/promises';
import { verifyFinalJpeg } from './ingest.ts';

// Revision 1 is executable, not a claim of universal MLS compliance.
export const TRANSFORMS = Object.freeze({
 full_res: Object.freeze({id:'client.fullres.share.v1',version:1,operation:'original_bytes',metadata:'preserve',status:'defined'}),
 gallery: Object.freeze({id:'web.listing.2048.v1',version:1,operation:'jpeg',encoder:'sharp-0.35.4_libvips-8.18.6_mozjpeg-0826579',progressive:false,mozjpeg:false,fit:'inside',maxSide:2048,quality:82,chroma:'4:2:0',orientation:'auto',colour:'srgb',metadata:'strip',enlarge:false,status:'defined'}),
 mls: Object.freeze({id:'ontario.proptx.provisional.2026-08-11.v1',version:1,operation:'jpeg',encoder:'sharp-0.35.4_libvips-8.18.6_mozjpeg-0826579',progressive:false,mozjpeg:false,fit:'inside',maxSide:2048,quality:90,chroma:'4:2:0',orientation:'auto',colour:'srgb',metadata:'strip',enlarge:false,status:'provisional',label:'Provisional MLS export — verify destination requirements'}),
});
export async function transformFinalJpeg(bytes: Buffer, kind:'gallery'|'mls', execution?:{signal:AbortSignal;check?:(tailMs:number)=>void}) {
 const hash=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
 execution?.signal.throwIfAborted();execution?.check?.(30_000);
 await verifyFinalJpeg(bytes, hash, bytes.length);
 const spec=TRANSFORMS[kind];
 if(`sharp-${sharp.versions.sharp}_libvips-${sharp.versions.vips}_mozjpeg-${sharp.versions.mozjpeg}`!==spec.encoder)throw new Error('finals_encoder_version_unapproved');
 // Validation and encoding each have a separate bounded native tail.
 execution?.signal.throwIfAborted();execution?.check?.(30_000);
 const result=await sharp(bytes,{limitInputPixels:100_000_000,failOn:'warning'}).timeout({seconds:30})
  .rotate().resize({width:spec.maxSide,height:spec.maxSide,fit:'inside',withoutEnlargement:true})
  .toColourspace('srgb').jpeg({quality:spec.quality,chromaSubsampling:spec.chroma,progressive:spec.progressive,mozjpeg:spec.mozjpeg})
  .toBuffer({resolveWithObject:true});
 if(result.data.length>33_554_432) throw new Error('finals_transform_bound');
 return {bytes:result.data,width:result.info.width,height:result.info.height};
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++) n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes:Buffer) {let crc=0xffffffff;for(const b of bytes) crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
/** Deterministic STORE ZIP32: one bounded JPEG at a time, central metadata only in RAM.
 * Fixed DOS epoch, no filenames supplied by customers, max 100 entries/1.1 GiB.
 */

export type ZipEntry = {name:string;load:()=>Promise<Buffer>};
/** Same ZIP32 STORE encoding as StoredZip, without filesystem writes. Each pass
 * reloads one immutable verified object. Only one photo, an 8MiB part and <=100
 * central headers survive; no whole-release spool and no ZIP64 ambiguity.
 */
export async function* streamStoredZip(inputs:readonly ZipEntry[],signal:AbortSignal):AsyncGenerator<Buffer>{
 if(inputs.length<1||inputs.length>100)throw new Error('zip_bound');
 async function* chunks(){
  let offset=0;const entries:Buffer[]=[];
  for(const input of inputs){
   signal.throwIfAborted();const bytes=await input.load();signal.throwIfAborted();
   if(input.name!==`${String(entries.length+1).padStart(3,'0')}.jpg`||bytes.length<1||bytes.length>33_554_432||offset+bytes.length>1_100_000_000)throw new Error('zip_bound');
   const filename=Buffer.from(input.name),crc=crc32(bytes),local=Buffer.alloc(30),central=Buffer.alloc(46);
   local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
   central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
   entries.push(Buffer.concat([central,filename]));offset+=local.length+filename.length+bytes.length;
   yield local;yield filename;yield bytes;
  }
  const start=offset;for(const entry of entries){yield entry;offset+=entry.length;}
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(offset-start,12);end.writeUInt32LE(start,16);yield end;
 }
 let part=Buffer.allocUnsafe(8*1024*1024),used=0;
 for await(const chunk of chunks()){
  let offset=0;
  while(offset<chunk.length){
   signal.throwIfAborted();const n=Math.min(part.length-used,chunk.length-offset);chunk.copy(part,used,offset,offset+n);used+=n;offset+=n;
   if(used===part.length){yield part;part=Buffer.allocUnsafe(8*1024*1024);used=0;}
  }
 }
 if(used)yield part.subarray(0,used);
}

export class StoredZip {
 private file: FileHandle; private offset=0; private entries:Buffer[]=[]; private closed=false;
 private constructor(file:FileHandle){this.file=file;}
 static async create(path:string){return new StoredZip(await open(path,'wx',0o600));}
 private async write(b:Buffer){let n=0;while(n<b.length){const r=await this.file.write(b,n,b.length-n);if(!r.bytesWritten)throw new Error('zip_short_write');n+=r.bytesWritten;}this.offset+=b.length;}
 async add(name:string,bytes:Buffer){
  if(this.closed || name!==`${String(this.entries.length+1).padStart(3,'0')}.jpg` || this.entries.length>=100 || bytes.length>33_554_432 || this.offset+bytes.length>1_100_000_000) throw new Error('zip_bound');
  const filename=Buffer.from(name), crc=crc32(bytes), local=Buffer.alloc(30), central=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(this.offset,42);
  this.entries.push(Buffer.concat([central,filename]));await this.write(local);await this.write(filename);await this.write(bytes);
 }
 async finish(){if(this.closed||!this.entries.length)throw new Error('zip_state');const start=this.offset;for(const entry of this.entries)await this.write(entry);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(this.entries.length,8);end.writeUInt16LE(this.entries.length,10);end.writeUInt32LE(this.offset-start,12);end.writeUInt32LE(start,16);await this.write(end);await this.close();}
 async close(){if(!this.closed){this.closed=true;await this.file.close();}}
}
