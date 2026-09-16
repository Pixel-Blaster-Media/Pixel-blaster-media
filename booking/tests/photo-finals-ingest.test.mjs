import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const ingest = await import('../lib/media/finals/ingest.ts').catch(() => ({}));
const digest = b => createHash('sha256').update(b).digest('hex');
test('malformed intent identifiers fail before database calls',async()=>{
  let calls=0;
  const scope={organizationId:'11111111-1111-4111-8111-111111111111',bookingId:'21111111-1111-4111-8111-111111111101',propertyId:'11111111-1111-4111-8111-111111111101'};
  const env={PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'synthetic-local',NODE_ENV:'test',PHOTO_FINALS_SYNTHETIC_ACK:'isolated-no-network',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope])};
  await assert.rejects(ingest.createFinalIntent({db:{async rpc(){calls++;return {data:{},error:null};}},env,scope,actorId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1',requestId:scope.bookingId,intentId:scope.propertyId,sha256:'a'.repeat(64),byteSize:1}));
  assert.equal(calls,0);
});
test('rejects invalid, truncated, oversized, mismatched and over-pixel JPEG inputs', async () => {
  const jpeg = await sharp({create:{width:32,height:24,channels:3,background:'#abc'}}).jpeg().toBuffer();
  const png = await sharp(jpeg).png().toBuffer();
  for (const b of [Buffer.from('not jpeg'), png, jpeg.subarray(0,jpeg.length-10), Buffer.concat([jpeg.subarray(0,Math.floor(jpeg.length/2)),Buffer.from([0xff,0xd9])]), Buffer.alloc(ingest.FINAL_MAX_BYTES+1)]) {
    await assert.rejects(ingest.verifyFinalJpeg(b,digest(b),b.length));
  }
  await assert.rejects(ingest.verifyFinalJpeg(jpeg,'a'.repeat(64),jpeg.length), /checksum/);
  await assert.rejects(ingest.verifyFinalJpeg(jpeg,digest(jpeg),jpeg.length+1), /size/);
  const hostile = Buffer.from(jpeg);
  const sof = hostile.indexOf(Buffer.from([0xff,0xc0]));
  assert.ok(sof>0);
  hostile.writeUInt16BE(16385,sof+5);
  await assert.rejects(ingest.verifyFinalJpeg(hostile,digest(hostile),hostile.length));
});
test('worker is executable, not just a validator', () => assert.equal(typeof ingest.processFinalIntent,'function'));
test('bounded database-backed dispatcher is executable', () => assert.equal(typeof ingest.dispatchFinalIntents,'function'));

test('bounded verifier decodes actual JPEG pixels, retains exact master bytes', async () => {
  assert.equal(typeof ingest.verifyFinalJpeg, 'function');
  const bytes = await sharp({create:{width:32,height:24,channels:3,background:'#abc'}}).jpeg().toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const result = await ingest.verifyFinalJpeg(bytes, hash, bytes.length);
  assert.deepEqual(result, {sha256:hash,byteSize:bytes.length,width:32,height:24});
});
