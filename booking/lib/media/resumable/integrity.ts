// Incremental fixed-state SHA-256; the pinned implementation encodes both
// length words big-endian, including packages at/above the 512 MiB boundary.
import {sha256} from '@noble/hashes/sha2.js';
export const hex=(bytes:Uint8Array)=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
export function incrementalHash(){
 const hash=sha256.create();
 return {update:(bytes:Uint8Array)=>{hash.update(bytes);},hex:async()=>hex(hash.digest())};
}
export async function digest(bytes:Uint8Array){const hash=incrementalHash();hash.update(bytes);return hash.hex();}
