import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {DiskS3} from '../helpers/photo-finals-disk-s3.mjs';
import {R2Storage} from '../../lib/media/storage/r2-core.ts';
import {createFinalIntent,processFinalIntent} from '../../lib/media/finals/ingest.ts';
import {prepareFinalRelease,approveFinalRelease,processFinalRelease} from '../../lib/media/finals/packages.ts';
const socket=process.env.PF_TEST_SOCKET;assert.match(socket??'',/^\/tmp\/pf-package-[^/]+$/);
const sql=s=>execFileSync(process.env.PF_TEST_PSQL,['-X','-qAt','-h',socket,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const literal=v=>v===null?'null':typeof v==='boolean'||typeof v==='number'?String(v):"'"+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
const db={async rpc(name,args){assert.match(name,/^photo_finals_[a-z_]+$/);try{return {data:JSON.parse(sql(`set role service_role;select to_jsonb(public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${literal(v)}`).join(',')}));`)||'null'),error:null};}catch(error){return {data:null,error};}}};
const scope={organizationId:'11111111-1111-4111-8111-111111111111',bookingId:'21111111-1111-4111-8111-111111111101',propertyId:'11111111-1111-4111-8111-111111111101'};
const env={PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'synthetic-local',NODE_ENV:'test',PHOTO_FINALS_SYNTHETIC_ACK:'isolated-no-network',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope])};
const actorId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',requestId=randomUUID();
const backend=await mkdtemp('/tmp/pf-resource-backend-'),scratch=await mkdtemp('/tmp/pf-resource-worker-');
const oldTmp=process.env.TMPDIR;process.env.TMPDIR=scratch;
const client=new DiskS3(backend),storage=new R2Storage({client,organizationId:scope.organizationId,buckets:{quarantine:'local-private-quarantine',masters:'local-private-masters',delivery:'local-private-delivery'}});
const hash=b=>createHash('sha256').update(b).digest('hex');
function paddedJpeg(base,size,index){
 const result=Buffer.alloc(size);base.copy(result,0,0,2);let offset=2,left=size-base.length;
 assert.ok(left>=4);
 while(left){let length=Math.min(65537,left);if(left-length>0&&left-length<4)length-=4;
  result[offset]=255;result[offset+1]=254;result.writeUInt16BE(length-2,offset+2);result.fill(index%255,offset+4,offset+length);offset+=length;left-=length;
 }
 base.copy(result,offset,2);return result;
}
let peakScratchBytes=0,peakRss=process.memoryUsage().rss,peakExternal=0;
async function scratchBytes(){let bytes=0;for(const name of await readdir(scratch)){const s=await stat(join(scratch,name));bytes+=s.size;}return bytes;}
const sampling=setInterval(()=>{const m=process.memoryUsage();peakRss=Math.max(peakRss,m.rss);peakExternal=Math.max(peakExternal,m.external);},10);
const started=performance.now();let evidence;
try{
 const jobs=[],hashes=[];let totalBytes=0;const sizes=Array.from({length:100},(_,i)=>i<31?33554432:Math.floor(33554432/69)+(i===99?33554432%69:0));
 assert.equal(sizes.reduce((a,b)=>a+b,0),1073741824);assert.equal(Math.max(...sizes),33554432);
 for(let n=0;n<100;n++){
  const base=await sharp({create:{width:n===0?10000:2500,height:n===0?10000:1250,channels:3,background:{r:n,g:123,b:51}}}).jpeg().toBuffer();
  const bytes=paddedJpeg(base,sizes[n],n);const sha=hash(bytes);hashes.push(sha);totalBytes+=bytes.length;
  const job=await createFinalIntent({db,env,scope,actorId,requestId,intentId:randomUUID(),sha256:sha,byteSize:bytes.length});jobs.push(job);
  await storage.putBufferCreateOnly({key:job.finals_quarantine_key,bytes,sha256:sha,contentType:'image/jpeg'});
  assert.equal((await processFinalIntent({db,storage,env,scope,jobId:job.id,workerId:'resource-ingest'})).status,'accepted');
  peakScratchBytes=Math.max(peakScratchBytes,await scratchBytes());
 }
 const beforePackage=performance.now();
 const draft=await prepareFinalRelease({db,env,scope,actorId,batchId:jobs[0].batch_id,releaseId:randomUUID(),expectedRevision:0,versionIds:jobs.map(j=>j.finals_version_id)});
 const approved=await approveFinalRelease({db,env,scope,actorId,releaseId:draft.id,revision:1,manifestSha256:draft.manifest_sha256.slice(2)});
 const originalRpc=db.rpc.bind(db);db.rpc=async(name,args)=>{peakScratchBytes=Math.max(peakScratchBytes,await scratchBytes());if(name==='photo_finals_package_finish')evidence=structuredClone(args.p_evidence);return originalRpc(name,args);};
 assert.equal((await processFinalRelease({db,storage,env,scope,jobId:approved.job_id,workerId:'resource-package'})).status,'ready');
 const packageMs=Math.round(performance.now()-beforePackage);
 const proofs=[];
 for(const kind of ['full_res_zip','mls_zip']){
  const e=evidence.find(e=>e.kind===kind),stored=client.objects.get(e.bucket+'/'+e.key);
  const proof=JSON.parse(execFileSync('python3',['-c','import sys,zipfile,json,hashlib;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({"names":z.namelist(),"crc":z.testzip(),"bytes":sum(i.file_size for i in z.infolist()),"hashes":[hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()]}))',stored.path],{encoding:'utf8'}));
  assert.equal(proof.crc,null);assert.deepEqual(proof.names,Array.from({length:100},(_,i)=>`${String(i+1).padStart(3,'0')}.jpg`));
  assert.deepEqual(proof.hashes,kind==='full_res_zip'?hashes:jobs.map(j=>evidence.find(e=>e.kind==='mls'&&e.version_id===j.finals_version_id).sha256));
  if(kind==='full_res_zip')assert.equal(proof.bytes,totalBytes);
  proofs.push({kind,zipBytes:e.bytes,sourceBytes:proof.bytes,entries:100,crcVerified:true,exactOrderAndContent:true});
 }
 assert.equal(client.uploads.size,0);assert.equal(await scratchBytes(),0);assert.equal(peakScratchBytes,0);
 console.log(JSON.stringify({passed:true,localOnly:true,deployedRuntimeCertified:false,files:100,totalOriginalBytes:totalBytes,maxSourceBytes:33554432,maxInputPixels:100000000,packageMs,totalMs:Math.round(performance.now()-started),peakSampledRssBytes:peakRss,processMaxRssKiB:process.resourceUsage().maxRSS,peakExternalBytes:peakExternal,peakWorkerScratchBytes:peakScratchBytes,peakTestBackendDiskBytes:client.peakBackendBytes,s3CommandCount:client.commandCount,archives:proofs}));
}finally{clearInterval(sampling);if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;await rm(backend,{recursive:true,force:true});await rm(scratch,{recursive:true,force:true});}
