import test from 'node:test';
import assert from 'node:assert/strict';
import {FinalsR2Storage} from '../lib/media/finals/storage.ts';
import {LocalS3} from './helpers/photo-finals-local-s3.mjs';
import {createHash} from 'node:crypto';

const organizationId='11111111-1111-4111-8111-111111111111';
const key=`quarantine/${organizationId}/21111111-1111-4111-8111-111111111111/31111111-1111-4111-8111-111111111111`;
const buckets={quarantine:'local-quarantine',masters:'local-masters',delivery:'local-delivery'};

test('finals refuses uncertified deletion before a provider that ignores IfMatch can remove source',async()=>{
 const client=new LocalS3(),send=client.send.bind(client);let deletes=0;
 client.send=async command=>{
  if(command.constructor.name==='DeleteObjectCommand'){
   deletes++;client.objects.delete(command.input.Bucket+'/'+command.input.Key);return {};
  }
  return send(command);
 };
 const storage=new FinalsR2Storage({client,organizationId,buckets});
 const bytes=Buffer.from('synthetic source'),sha256=createHash('sha256').update(bytes).digest('hex');
 await storage.putBufferCreateOnly({key,bytes,sha256,contentType:'image/jpeg'});
 await assert.rejects(storage.deleteQuarantine({key,expectedEtag:'"wrong-etag"'}),/finals_quarantine_delete_uncertified/);
 assert.equal(deletes,0);
 assert.deepEqual(client.objects.get(buckets.quarantine+'/'+key).bytes,bytes);
 await assert.rejects(storage.putBufferCreateOnly({key,bytes,sha256,contentType:'image/jpeg'}),/exists/);
});
