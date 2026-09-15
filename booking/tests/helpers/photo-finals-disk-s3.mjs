// Local disk-backed S3 command double: test backend bytes are not worker scratch.
// Never connects to a network and never retains complete releases in RAM.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {writeFile,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
export class DiskS3 {
 objects=new Map();uploads=new Map();storedBytes=0;peakBackendBytes=0;commandCount=0;
 constructor(directory){this.directory=directory;}
 async send(command,options={}){
  options.abortSignal?.throwIfAborted();this.commandCount++;
  const i=command.input,name=command.constructor.name,key=i.Bucket+'/'+i.Key,old=this.objects.get(key);
  const absent=()=>{throw Object.assign(new Error('local missing'),{name:'NotFound',$metadata:{httpStatusCode:404}});};
  const etag=b=>'"'+createHash('sha256').update(b).digest('hex')+'"';
  const add=n=>{this.storedBytes+=n;this.peakBackendBytes=Math.max(this.peakBackendBytes,this.storedBytes);};
  if(name==='PutObjectCommand'){
   assert.equal(i.IfNoneMatch,'*');if(old)throw Object.assign(new Error('exists'),{name:'PreconditionFailed'});
   const path=join(this.directory,randomUUID());await writeFile(path,i.Body,{flag:'wx'});add(i.Body.length);
   const value={path,bytes:i.Body.length,etag:etag(i.Body),metadata:i.Metadata,type:i.ContentType};this.objects.set(key,value);return {ETag:value.etag};
  }
  if(name==='GetObjectCommand'||name==='HeadObjectCommand'){
   if(!old)return absent();return {ContentLength:old.bytes,ETag:old.etag,Metadata:old.metadata,ContentType:old.type,...(name==='GetObjectCommand'?{Body:createReadStream(old.path,{highWaterMark:1024*1024,signal:options.abortSignal})}:{})};
  }
  if(name==='DeleteObjectCommand'){
   if(!old)return absent();assert.equal(i.IfMatch,old.etag);await rm(old.path);add(-old.bytes);this.objects.delete(key);return {};
  }
  if(name==='CreateMultipartUploadCommand'){
   const id=randomUUID(),path=join(this.directory,id);this.uploads.set(id,{path,file:await open(path,'wx'),bytes:0,parts:[],input:i,hash:createHash('sha256')});return {UploadId:id};
  }
  if(name==='UploadPartCommand'){
   const u=this.uploads.get(i.UploadId);assert.ok(u);assert.equal(i.PartNumber,u.parts.length+1);
   let n=0;while(n<i.Body.length){const r=await u.file.write(i.Body,n,i.Body.length-n);assert.ok(r.bytesWritten);n+=r.bytesWritten;}
   u.hash.update(i.Body);u.bytes+=i.Body.length;add(i.Body.length);const part={PartNumber:i.PartNumber,ETag:etag(i.Body)};u.parts.push(part);return {ETag:part.ETag};
  }
  if(name==='CompleteMultipartUploadCommand'){
   const u=this.uploads.get(i.UploadId);assert.ok(u);assert.equal(i.IfNoneMatch,'*');if(old)throw Object.assign(new Error('exists'),{name:'PreconditionFailed'});
   assert.deepEqual(i.MultipartUpload.Parts,u.parts);await u.file.close();const value={path:u.path,bytes:u.bytes,etag:'"'+u.hash.digest('hex')+'"',metadata:u.input.Metadata,type:u.input.ContentType};
   this.objects.set(key,value);this.uploads.delete(i.UploadId);return {ETag:value.etag};
  }
  if(name==='AbortMultipartUploadCommand'){
   const u=this.uploads.get(i.UploadId);if(u){await u.file.close();await rm(u.path);add(-u.bytes);this.uploads.delete(i.UploadId);}return {};
  }
  throw new Error('unexpected command '+name);
 }
}
