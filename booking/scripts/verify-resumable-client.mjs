// Local auth/range doubles only; real bundled production worker + Chromium OPFS.
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const out=process.env.CLIENT_EVIDENCE||'/Users/PlatoTheBot/.hermes/audits/pixel-photo-finals/resumable-download-evidence-0915';await mkdir(out,{recursive:true});
if(process.argv.includes('--controller'))await access('lib/media/resumable/controller.ts').catch(()=>assert.fail('Production controller missing'));
await access('lib/media/resumable/download.worker.ts').catch(()=>assert.fail('Production OPFS worker missing'));
execFileSync('python3',['-c',`import zipfile,hashlib\nwith zipfile.ZipFile('${out}/client-source.zip','w',compression=zipfile.ZIP_STORED) as z:\n with z.open('synthetic.bin','w') as f:\n  for i in range(128):f.write(hashlib.shake_256(str(i).encode()).digest(65536))`]);
const source=await readFile(out+'/client-source.zip'),sha=b=>createHash('sha256').update(b).digest('hex');
const m={transferId:'00000000-0000-4000-8000-000000000001',packageId:'00000000-0000-4000-8000-000000000002',packageSha256:sha(source),indexSha256:'a'.repeat(64),byteSize:source.length,chunkSize:131072,chunkCount:Math.ceil(source.length/131072),chunkDigests:[]};for(let i=0;i<m.chunkCount;i++)m.chunkDigests.push(sha(source.subarray(i*131072,Math.min(source.length,(i+1)*131072))));
await build({entryPoints:['lib/media/resumable/download.worker.ts'],bundle:true,format:'iife',platform:'browser',outfile:out+'/client-worker.js',metafile:true}).then(r=>writeFile(out+'/client-bundle-inputs.json',JSON.stringify(r.metafile.inputs,null,2)));
if(process.argv.includes('--controller'))await build({entryPoints:['lib/media/resumable/controller.ts'],bundle:true,format:'iife',globalName:'Pixel',platform:'browser',outfile:out+'/client-controller.js'});
let slow=false,revoked=false,fault='';const requests=[];
const server=createServer(async(req,res)=>{
 if(req.url==='/controller.js'){res.setHeader('Content-Type','text/javascript');return res.end(await readFile(out+'/client-controller.js'));}
 if(req.url==='/worker.js'){res.setHeader('Content-Type','text/javascript');return res.end(await readFile(out+'/client-worker.js'));}
 if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(`<button id="save">Save ZIP</button>${process.argv.includes('--controller')?'<script src="/controller.js"></script>':''}<script>window.events=[];window.start=m=>{window.done=null;window.w=new Worker('/worker.js');w.onmessage=e=>{events.push(e.data);if(['ready','paused','error','busy','quota','unsupported'].includes(e.data.state))window.done=e.data};w.postMessage({op:'start',metadata:m,endpoint:'/resume',identity:'local-session'});};</script>`);}
 if(req.url.startsWith('/resume')){if(revoked){res.writeHead(403);return res.end();}const u=new URL(req.url,'http://localhost');if(!u.searchParams.has('index'))return res.end(JSON.stringify(m));const i=Number(u.searchParams.get('index'));requests.push(i);const start=i*131072,end=Math.min(source.length,start+131072);if(slow)await new Promise(r=>setTimeout(r,1000));let b=source.subarray(start,end);if(fault==='tamper'){b=Buffer.from(b);b[0]^=1;}res.writeHead(206,{'Content-Length':b.length,'Content-Range':`bytes ${start}-${end-1}/${source.length}`,'ETag':`"${m.packageSha256}"`,'X-Chunk-Sha256':m.chunkDigests[i]});return res.end(b);}
 res.writeHead(404);res.end();
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true}),context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 if(process.argv.includes('--controller')){
  await page.evaluate(()=>{window.c=new Pixel.DownloadController({endpoint:'/resume',identity:'local-session',packageType:'originals',worker:()=>new Worker('/worker.js'),report:p=>{events.push(p);window.done=p;}});document.querySelector('#save').onclick=()=>c.save().catch(()=>{});});
  if(process.argv.includes('--lifecycle')){
   slow=true;await page.evaluate(()=>c.start());await page.waitForFunction(()=>events.some(e=>e.bytes>=131072));
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
   assert.equal(await page.evaluate(()=>done.state),'paused','visibility must pause immediately');
   await page.evaluate(()=>c.changeIdentity('different-session'));await page.waitForFunction(()=>done.state==='idle');
   assert.equal(await page.evaluate(async()=>Array.fromAsync((await navigator.storage.getDirectory()).keys())).then(a=>a.length),0);console.log('visibility pause and session cleanup passed');
  }else{
  if(process.argv.includes('--unsupported'))await page.evaluate(()=>{Object.defineProperty(navigator,'locks',{value:undefined});});
  if(process.argv.includes('--quota'))await page.evaluate(()=>{navigator.storage.estimate=async()=>({usage:0,quota:0});});
  await page.evaluate(()=>c.start());await page.waitForFunction(()=>['ready','quota','unsupported','error'].includes(done.state));
  if(process.argv.includes('--unsupported')){assert.equal(await page.evaluate(()=>done.state),'unsupported');assert.equal(requests.length,0);console.log('unsupported capability passed');}else if(process.argv.includes('--quota')){assert.equal(await page.evaluate(()=>done.state),'quota');assert.equal(requests.length,0);console.log('quota preflight passed');}else{
  revoked=true;await page.click('#save');await page.waitForFunction(()=>done.state==='error');assert.equal(await page.evaluate(()=>events.some(e=>e.state==='save-initiated')),false);
  revoked=false;await page.evaluate(()=>c.start());await page.waitForFunction(()=>done.state==='ready');const dp=page.waitForEvent('download');await page.click('#save');await (await dp).saveAs(out+'/client-export.zip');assert.equal(await page.evaluate(()=>done.state),'save-initiated');
  await page.evaluate(()=>c.discard());assert.equal(await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();return Array.fromAsync(root.keys());}).then(x=>x.filter(x=>x.startsWith('pixel-resume-')).length),0);
  console.log('controller fresh authority, disk-backed Save, discard passed');
  }
 }
 }else if(process.argv.includes('--corrupt')){
  await page.evaluate(m=>start(m),m);await page.waitForFunction(()=>done!==null);assert.equal(await page.evaluate(()=>done.state),'ready',JSON.stringify(await page.evaluate(()=>done)));
  await page.evaluate(async m=>{w.terminate();const code=`onmessage=async({data})=>{const h=await(await navigator.storage.getDirectory()).getFileHandle(data);const a=await h.createSyncAccessHandle();const b=new Uint8Array(1);a.read(b,{at:131072});b[0]^=1;a.write(b,{at:131072});a.flush();a.close();postMessage('done')}`;const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));const mutator=new Worker(url);await new Promise((resolve,reject)=>{mutator.onmessage=resolve;mutator.onerror=reject;mutator.postMessage('pixel-resume-'+m.indexSha256+'.zip')});mutator.terminate();URL.revokeObjectURL(url);},m);
  const before=requests.length;await page.evaluate(m=>start(m),m);await page.waitForFunction(()=>done?.state==='ready');const result=await page.evaluate(()=>done);assert.equal(result.resumedAt,131072);assert.equal(result.sha256,m.packageSha256);assert.equal(requests[before],1);console.log('actual Chromium corrupt OPFS prefix truncated and remainder reverified');
 }else if(process.argv.includes('--locks')){
  slow=true;await page.evaluate(m=>start(m),m);await page.waitForFunction(()=>events.some(e=>e.state==='verifying'));
  const other=await context.newPage();await other.goto(page.url());await other.evaluate(m=>start(m),m);await other.waitForFunction(()=>done!==null);assert.equal(await other.evaluate(()=>done.state),'busy','cross-tab contention must report busy, not generic error');
  await page.evaluate(()=>w.postMessage({op:'pause'}));await page.waitForFunction(()=>done?.state==='paused');console.log('cross-tab lock exclusion passed');
 }else{
 slow=true;const began=Date.now();await page.evaluate(m=>start(m),m);
 await page.waitForFunction(()=>events.some(e=>e.bytes>=393216),{},{timeout:20000});await page.evaluate(()=>w.postMessage({op:'pause'}));await page.waitForFunction(()=>done?.state==='paused');const partial=await page.evaluate(()=>events.filter(e=>e.state==='downloading').at(-1));
 await page.reload();await page.evaluate(m=>start(m),m);await page.waitForFunction(()=>done?.state==='ready',{},{timeout:100000});const result=await page.evaluate(()=>done),elapsed=Date.now()-began;assert.equal(result.resumedAt,partial.bytes);assert.equal(result.sha256,m.packageSha256);assert(elapsed>60000);
 await page.evaluate(m=>{document.querySelector('#save').onclick=async()=>{const r=await fetch('/resume?transferId='+m.transferId);if(!r.ok)throw Error('authority');const root=await navigator.storage.getDirectory(),h=await root.getFileHandle('pixel-resume-'+m.indexSha256+'.zip'),f=await h.getFile(),a=document.createElement('a');a.download='client-export.zip';a.href=URL.createObjectURL(f);a.click();};},m);
 const downloadP=page.waitForEvent('download');await page.click('#save');await (await downloadP).saveAs(out+'/client-export.zip');
 await writeFile(out+'/client-browser.json',JSON.stringify({evidenceTier:'local auth/range doubles; real production worker/hasher, Chromium; NOT SQL/S3/provider/iOS',partial,result,elapsed,requests,userAgent:await page.evaluate(()=>navigator.userAgent)},null,2));
 console.log(JSON.stringify({passed:true,elapsed,resumedAt:result.resumedAt,sha256:result.sha256}));
}
}finally{await browser.close();await new Promise(r=>server.close(r));}
