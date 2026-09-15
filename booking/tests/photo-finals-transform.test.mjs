import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { transformFinalJpeg, StoredZip, TRANSFORMS } from '../lib/media/finals/transforms.ts';
test('versioned transforms preserve originals and produce bounded metadata-free JPEG; real ordered ZIP',async()=>{
 const source=await sharp({create:{width:3000,height:1500,channels:3,background:'#abc'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const gallery=await transformFinalJpeg(source,'gallery');
 const mls=await transformFinalJpeg(source,'mls');
 assert.equal(gallery.width,1024);assert.equal(gallery.height,2048);
 assert.equal(mls.width,1024);assert.equal(mls.height,2048);
 assert.equal((await sharp(gallery.bytes).metadata()).exif,undefined);
 assert.equal(TRANSFORMS.mls.status,'provisional');
 assert.equal(TRANSFORMS.gallery.encoder,'sharp-0.35.4_libvips-8.18.6_mozjpeg-0826579');
 assert.equal(TRANSFORMS.gallery.progressive,false);
 const dir=await mkdtemp(join(tmpdir(),'pf-zip-'));
 try {const path=join(dir,'actual.zip');const zip=await StoredZip.create(path);
 await zip.add('001.jpg',source);await zip.add('002.jpg',mls.bytes);await zip.finish();
 const info=JSON.parse(execFileSync('python3',['-c','import zipfile,json,sys,hashlib;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({"names":z.namelist(),"valid":z.testzip(),"first":list(z.read("001.jpg"))}))',path],{encoding:'utf8'}));
 assert.deepEqual(info.names,['001.jpg','002.jpg']);assert.equal(info.valid,null);assert.deepEqual(Buffer.from(info.first),source);
 assert.ok((await readFile(path)).length>source.length);
 } finally {await rm(dir,{recursive:true,force:true});}
});
