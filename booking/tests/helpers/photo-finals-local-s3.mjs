// Test-only command adapter, in-memory local objects. NOT live R2/provider proof.
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
export class LocalS3 {
  objects=new Map();
  puts=0;
  loseNextMasterPut=false;
  async send(command) {
    const i=command.input, k=i.Bucket+'/'+i.Key, name=command.constructor.name;
    const old=this.objects.get(k);
    const missing=()=>{throw Object.assign(new Error('local absent'),{name:'NotFound',$metadata:{httpStatusCode:404}});};
    if(name==='PutObjectCommand') {
      if(i.IfNoneMatch!=='*') throw new Error('create-only missing');
      if(old) throw Object.assign(new Error('exists'),{name:'PreconditionFailed'});
      const b=Buffer.from(i.Body);
      const e='"'+createHash('sha256').update(b).digest('hex')+'"';
      this.objects.set(k,{bytes:b,metadata:i.Metadata,type:i.ContentType,etag:e}); this.puts++;
      if(this.loseNextMasterPut && i.Key.startsWith('masters/')) {this.loseNextMasterPut=false;throw new Error('synthetic lost PUT response');}
      return {ETag:e};
    }
    if(name==='GetObjectCommand'||name==='HeadObjectCommand') {
      if(!old) return missing();
      return {ContentLength:old.bytes.length,Metadata:old.metadata,ContentType:old.type,ETag:old.etag,
        ...(name==='GetObjectCommand'?{Body:Readable.from([Buffer.from(old.bytes)])}:{})};
    }
    if(name==='DeleteObjectCommand') {
      if(!old) return missing();
      if(i.IfMatch!==old.etag) throw new Error('delete identity mismatch');
      this.objects.delete(k);return {};
    }
    throw new Error('Unexpected local S3 command '+name);
  }
}
