// This exact pure-JS implementation retains fixed SHA state, not prior inputs.
import {Sha256} from '@aws-crypto/sha256-js';
export const hex=(bytes:Uint8Array)=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
export function incrementalHash(){
 const hash=new Sha256();
 return {update:(bytes:Uint8Array)=>hash.update(bytes),hex:async()=>hex(await hash.digest())};
}
export async function digest(bytes:Uint8Array){const hash=incrementalHash();hash.update(bytes);return hash.hex();}
