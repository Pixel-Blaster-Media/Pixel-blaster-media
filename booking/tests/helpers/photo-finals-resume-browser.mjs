// Independent parent integration: actual handler/SQL and exact production worker.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {chromium} from 'playwright';
export async function routeBrowserProof({handler,scope,metadata,setSlow}){
 const out=process.env.PF_EVIDENCE_DIR||'/Users/PlatoTheBot/.hermes/audits/pixel-photo-finals/resumable-download-evidence-0915';await mkdir(out,{recursive:true});
 const buildResult=await build({entryPoints:['lib/media/resumable/download.worker.ts'],bundle:true,format:'iife',platform:'browser',outfile:out+'/parent-route-worker.js',metafile:true});
 await writeFile(out+'/parent-route-worker-inputs.json',JSON.stringify(buildResult.metafile.inputs,null,2));
 const lifecycle=await build({entryPoints:['lib/media/resumable/lifecycle.ts'],bundle:true,write:false,format:'iife',globalName:'Lifecycle',platform:'browser'});
 const ui=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Download from './components/media/ResumableDownload';createRoot(document.getElementById('root')).render(<Download endpoint="/resume" identity="local-test-actor" packageId="${metadata.packageId}" packageType="originals" label="Full-resolution ZIP"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const {default:postcss}=await import('postcss'),{default:tailwind}=await import('tailwindcss');
 const css=(await postcss([tailwind({content:['components/media/ResumableDownload.tsx'],theme:{extend:{}}})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
 let origin;
 const server=createServer(async(req,res)=>{
  try{
   if(req.url==='/lifecycle.js'){res.setHeader('Content-Type','text/javascript');res.end(lifecycle.outputFiles[0].text);return;}
   if(req.url==='/ui'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><main style="padding:16px;max-width:600px"><div id="root"></div></main><script type="module" src="/ui.js"></script>');return;}
   if(req.url==='/ui.js'){res.setHeader('Content-Type','text/javascript');res.end(ui.outputFiles[0].text);return;}
   if(req.url==='/worker.js'||req.url.endsWith('/download.worker.ts')){res.setHeader('Content-Type','text/javascript');res.end(await readFile(out+'/parent-route-worker.js'));return;}
   if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<button id="save">Save ZIP</button><script src="/lifecycle.js"></script><script>window.events=[];window.start=async m=>{const epoch=await Lifecycle.captureDownloadEpoch();window.done=null;window.w=new Worker("/worker.js");w.onmessage=e=>{events.push(e.data);if(["ready","paused","error","quota","busy","unsupported","budget-exhausted"].includes(e.data.state))window.done=e.data;};w.postMessage({op:"start",metadata:m,endpoint:"/resume",epoch});};</script>');return;}
   const abort=new AbortController();req.on('aborted',()=>abort.abort());res.on('close',()=>{if(!res.writableEnded)abort.abort();});
   const parts=[];for await(const b of req)parts.push(b);
   const response=await handler(new Request(origin+req.url,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(parts):undefined,signal:abort.signal}),scope.bookingId);
   res.writeHead(response.status,Object.fromEntries(response.headers));
   if(response.body){const reader=response.body.getReader();try{for(;;){const n=await reader.read();if(n.done)break;res.write(n.value);}}finally{void reader.cancel();}}
   res.end();
  }catch{if(!res.headersSent)res.writeHead(503);res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();
 try{
  await page.goto(origin);setSlow(true);const began=Date.now();await page.evaluate(m=>start(m),metadata);
  await page.waitForFunction(()=>events.some(e=>e.state==='downloading'&&e.bytes>=393216),{},{timeout:25000});await page.evaluate(()=>w.postMessage({op:'pause'}));await page.waitForFunction(()=>done?.state==='paused');
  const partial=await page.evaluate(()=>events.filter(e=>e.state==='downloading').at(-1));
  await page.reload();await page.evaluate(m=>start(m),metadata);await page.waitForFunction(()=>done?.state==='ready'||done?.state==='error',{},{timeout:140000});
  const result=await page.evaluate(()=>done);assert.equal(result.state,'ready',JSON.stringify(result));assert.equal(result.resumedAt,partial.bytes);assert.equal(result.sha256,metadata.packageSha256);const elapsed=Date.now()-began;assert.ok(elapsed>60000,'actual aggregate exceeds60s');setSlow(false);
  await page.evaluate(m=>{document.querySelector('#save').onclick=async()=>{const r=await fetch('/resume?transferId='+m.transferId);if(!r.ok)throw Error('authority denied');const current=await r.json();if(current.indexSha256!==m.indexSha256)throw Error('identity changed');const root=await navigator.storage.getDirectory(),h=await root.getFileHandle('pixel-resume-'+m.indexSha256+'.zip'),f=await h.getFile();const a=document.createElement('a');a.download='parent-route-export.zip';a.href=URL.createObjectURL(f);a.click();window.saveState='save initiated';};},metadata);
  const download=page.waitForEvent('download');await page.click('#save');await(await download).saveAs(out+'/parent-route-export.zip');
  const independent=JSON.parse(execFileSync('python3',['-c',`import hashlib,zipfile,json\np=${JSON.stringify(out+'/parent-route-export.zip')}\nh=hashlib.sha256()\nwith open(p,'rb') as f:\n while True:\n  b=f.read(131072)\n  if not b:break\n  h.update(b)\nwith zipfile.ZipFile(p) as z:\n assert z.testzip() is None\n print(json.dumps({'sha256':h.hexdigest(),'zipCRC':'passed','entries':z.namelist()}))`],{encoding:'utf8'}));assert.equal(independent.sha256,metadata.packageSha256);
  const saveState=await page.evaluate(()=>saveState);
  await page.goto(origin+'/ui');await page.getByRole('button',{name:'Prepare ZIP',exact:true}).click();
  await page.getByRole('button',{name:'Save ZIP',exact:true}).waitFor({timeout:30000});
  const geometry=[];
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:800});const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,right:r.right,height:r.height};})}));assert.ok(bounds.scroll<=width);assert.ok(bounds.buttons.every(b=>b.x>=0&&b.right<=width&&b.height>=44));geometry.push(bounds);await page.screenshot({path:out+`/download-ui-${width}.png`});}
  const uiDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Save ZIP',exact:true}).click();await(await uiDownload).saveAs(out+'/ui-export.zip');
  await page.getByRole('status').filter({hasText:'Save initiated'}).waitFor();
  const uiBytes=await readFile(out+'/ui-export.zip');const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(uiBytes).digest('hex'),metadata.packageSha256);
  await page.getByRole('button',{name:'Discard local progress',exact:true}).click();await page.getByRole('button',{name:'Prepare ZIP',exact:true}).waitFor();
  assert.equal(await page.evaluate(async()=>{let n=0;for await(const key of (await navigator.storage.getDirectory()).keys())if(/^pixel-resume-[a-f0-9]{64}\.zip$/.test(key))n++;return n;}),0);
  const evidence={passed:true,ui:{actualComponent:true,saveInitiated:true,discardClean:true,geometry},evidenceTier:'loopback actual application handler + PostgreSQL + R2 adapter + production worker/hasher; local auth and S3 doubles; NOT built Next auth, real provider or physical iPhone',elapsed,partial,result,independent,userAgent:await page.evaluate(()=>navigator.userAgent),saveState};
  await writeFile(out+'/parent-route-browser.json',JSON.stringify(evidence,null,2));return evidence;
 }finally{setSlow(false);await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
