// Test-only actual command payload capture, never an external provider.
import { LocalS3 } from './photo-finals-local-s3.mjs';
import { createHash,randomUUID } from 'node:crypto';
export class PackageLocalS3 extends LocalS3 {
 uploads=new Map(); failMls=false; loseFullResponse=false;
 async send(command){
  const i=command.input,name=command.constructor.name,k=i.Bucket+'/'+i.Key;
  if(this.failMls&&i.Key?.includes('/mls_zip/'))throw new Error('injected partial package failure');
  if(name==='CreateMultipartUploadCommand'){const id=randomUUID();this.uploads.set(id,{input:i,parts:new Map()});return {UploadId:id};}
  if(name==='UploadPartCommand'){const u=this.uploads.get(i.UploadId);if(!u)throw new Error('upload missing');const b=Buffer.from(i.Body),etag='"'+createHash('sha256').update(b).digest('hex')+'"';u.parts.set(i.PartNumber,{b,etag});return {ETag:etag};}
  if(name==='AbortMultipartUploadCommand'){this.uploads.delete(i.UploadId);return {};}
  if(name==='CompleteMultipartUploadCommand'){
   const u=this.uploads.get(i.UploadId);if(!u||i.IfNoneMatch!=='*')throw new Error('create only required');
   if(this.objects.has(k))throw Object.assign(new Error('exists'),{name:'PreconditionFailed'});
   const bytes=Buffer.concat(i.MultipartUpload.Parts.map(p=>{const part=u.parts.get(p.PartNumber);if(part.etag!==p.ETag)throw new Error('part mismatch');return part.b;}));
   const etag='"'+createHash('sha256').update(bytes).digest('hex')+'"';
   this.objects.set(k,{bytes,etag,type:u.input.ContentType,metadata:u.input.Metadata});this.uploads.delete(i.UploadId);
   if(this.loseFullResponse&&i.Key.includes('/full_res_zip/')){this.loseFullResponse=false;throw new Error('lost completion response');}
   return {ETag:etag};
  }
  return super.send(command);
 }
}
