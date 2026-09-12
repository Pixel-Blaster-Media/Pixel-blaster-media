// TEST ONLY: loopback HTTP storage + synthetic sessions. Not imported by application.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {AsyncLocalStorage} from 'node:async_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import sharp from 'sharp';
import {common} from '../../lib/media/finals/application.ts';
export async function browserProof({db,storage,sql,env,scope,actorId}){
 const {chromium}=await import(process.env.PF_PLAYWRIGHT_MODULE??homedir()+'/.hermes/designs/pixel-precision-preview/node_modules/playwright/index.mjs');
 const source=`import React from 'react';import{createRoot}from'react-dom/client';import Workspace from './components/media/PhotoFinalsWorkspace';import NavigationOwner from './components/media/FinalsNavigationOwner';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<NavigationOwner><a style={{display:'inline-flex',minHeight:44,alignItems:'center'}} href="/?tab=delivery">Delivery workspace</a><a style={{display:'inline-flex',minHeight:44,alignItems:'center'}} href="/?record=other">Another property</a><Workspace bookingId="${scope.bookingId}" operator={q.get('role')!=='realtor'} incumbent={q.has('iguide')?[{category:'photos',label:'iGUIDE MLS',source:'iguide',slot:'photos_mls',url:'/test-only/iguide-unavailable'}]:[]}/></NavigationOwner>);`;
 const bundled=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,metafile:true,format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const css=(await postcss([tailwind({content:['components/media/PhotoFinalsWorkspace.tsx','components/media/FinalsGallery.tsx'],theme:{extend:{}}})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
 const realtor=randomUUID(),wrong=randomUUID();
 sql(`insert into profiles values ('${realtor}','${scope.organizationId}','realtor','realtor@example.invalid',null),('${wrong}','${scope.organizationId}','realtor','wrong@example.invalid',null);update bookings set owner_id='${realtor}' where id='${scope.bookingId}';update properties set owner_id='${realtor}' where id='${scope.propertyId}'`);
 const identities={operator:{actorId,scope,operator:true},realtor:{actorId:realtor,scope,operator:false},wrong:{actorId:wrong,scope,operator:false},tenant:{actorId,scope:{...scope,organizationId:randomUUID()},operator:true}};
 const sessions=new Map(Object.entries(identities).map(([role,identity])=>[randomUUID(),{role,identity}]));
 const caps=new Map();let origin='',uploadCount=0,httpCount=0,failRead=false,failOnce='',failedRequests=[];
 const identify=req=>sessions.get((req.headers.get('cookie')??'').replace(/^session=/,''))?.identity??null;
 const runtime={db,storage,env,async issueUpload(job,identity){
  assert.equal(sql(`select count(*) from media_ingest_jobs where id='${job.id}'`),'1');
  const token=randomUUID(),expires=Math.min(Date.now()+60000,Date.parse(job.finals_deadline));caps.set(token,{job,identity,expires});
  return {url:origin+'/test-only/upload/'+token,headers:{'content-type':'image/jpeg','x-test-sha256':job.finals_sha256.slice(2),'if-none-match':'*'},expiresAt:new Date(expires).toISOString()};
 }};
 // Compile the ACTUAL Next route exports. Only authentication/session RLS and
 // production factory are replaced, explicitly test-only; HTTP/application/SQL/
 // decode/storage/package logic stays real. ALS prevents cross-request identity.
 const contextStore=new AsyncLocalStorage();
 const bridgeKey='__TEST_ONLY_PHOTO_FINALS_ROUTE__';
 globalThis[bridgeKey]={contextStore,runtime,scope};
 const shim=`const b=globalThis.${bridgeKey};`;
 const routeBuild=await build({entryPoints:['app/api/photo-finals/[bookingId]/route.ts'],bundle:true,write:false,metafile:true,platform:'node',packages:'external',format:'esm',plugins:[{name:'test-only-session-and-runtime',setup(build){
  build.onResolve({filter:/^@\/lib\/(auth\/current-user|supabase\/server|media\/finals\/production)$/},args=>({path:args.path,namespace:'test-only'}));
  build.onLoad({filter:/.*/,namespace:'test-only'},args=>({loader:'js',contents:shim+(args.path.endsWith('current-user')?`export async function getCurrentUserResult(){const i=b.contextStore.getStore();return i?{kind:'active',profile:{userId:i.actorId,organizationId:i.scope.organizationId,archivedAt:null,role:i.operator?'admin':'realtor'}}:{kind:'missing'};}`:args.path.endsWith('production')?`export async function createProductionFinalsRuntime(){return b.runtime;}`:`export async function getServerSupabase(){return {from(){const filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},async maybeSingle(){const i=b.contextStore.getStore();return {data:i&&filters.id===b.scope.bookingId&&filters.organization_id===b.scope.organizationId?{id:b.scope.bookingId,property_id:b.scope.propertyId,status:'editing'}:null,error:null}}};return q}};}`)}));
 }}]});
 const routeDirectory=resolve('node_modules/.cache/photo-finals-test-'+randomUUID());await mkdir(routeDirectory,{recursive:true});const routePath=resolve(routeDirectory,'route.mjs');await writeFile(routePath,routeBuild.outputFiles[0].contents);
 const actualRoute=await import(pathToFileURL(routePath).href+'?'+randomUUID());
 const handler=(request,bookingId)=>contextStore.run(identify(request),()=>actualRoute[request.method](request,{params:Promise.resolve({bookingId})}));
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,origin);let response;
   const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
   const operation=req.method==='POST'?(await request.clone().json()).op:req.method==='PUT'?'put':'';
   if(url.pathname.startsWith('/api/photo-finals/')){httpCount++;response=failRead&&req.method==='GET'?Response.json({error:'Synthetic read error'},{status:503}):await handler(request,url.pathname.split('/').pop());}
   else if(url.pathname.startsWith('/test-only/upload/')&&req.method==='PUT'){
    const token=url.pathname.split('/').pop(),cap=caps.get(token),identity=identify(request);
    if(!cap||cap.expires<=Date.now()||identity?.actorId!==cap.identity.actorId||request.headers.get('if-none-match')!=='*'||request.headers.get('x-test-sha256')!==cap.job.finals_sha256.slice(2)||request.headers.get('content-type')!=='image/jpeg'){response=new Response(null,{status:403});}
    else{
     const checked=await db.rpc('photo_finals_upload_target',{...common(identity),p_job:cap.job.id});if(checked.error)throw new Error('denied');
     let size=0;const chunks=[];for await(const chunk of request.body){size+=chunk.length;if(size>cap.job.finals_byte_size)throw new Error('size');chunks.push(Buffer.from(chunk));}
     const bytes=Buffer.concat(chunks);if(size!==cap.job.finals_byte_size||createHash('sha256').update(bytes).digest('hex')!==cap.job.finals_sha256.slice(2))throw new Error('identity');
     caps.delete(token);await storage.putBufferCreateOnly({key:cap.job.finals_quarantine_key,bytes,sha256:cap.job.finals_sha256.slice(2),contentType:'image/jpeg'});uploadCount++;response=new Response(null,{status:201});
    }
   }else if(url.pathname==='/test-only/iguide-unavailable'){response=new Response(null,{status:503});}
   else if(req.method==='GET'&&url.pathname==='/'){response=new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test-only photo finals</title><link rel="stylesheet" href="/fixture.css"><main style="max-width:1000px;margin:auto;padding:12px"><p>TEST ONLY · Synthetic PostgreSQL, local storage and sessions</p><div id="root"></div></main><script type="module" src="/fixture.js"></script>',{headers:{'content-type':'text/html'}});}
   else if(req.method==='GET'&&url.pathname==='/fixture.js')response=new Response(bundled.outputFiles[0].contents,{headers:{'content-type':'text/javascript'}});
   else if(req.method==='GET'&&url.pathname==='/fixture.css')response=new Response(css,{headers:{'content-type':'text/css'}});
   else response=new Response(null,{status:404});
   if(failOnce&&operation===failOnce&&response.ok){failOnce='';response=Response.json({error:'Synthetic response loss after commit'},{status:503});}
   res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)for await(const chunk of response.body)res.write(chunk);res.end();
  }catch{res.writeHead(503);res.end('Test operation denied');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.PF_CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const out=process.env.PF_EVIDENCE_DIR??'/tmp/pixel-finals-browser-evidence';await mkdir(out,{recursive:true});
 await writeFile(out+'/resolved-modules.json',JSON.stringify({client:Object.keys(bundled.metafile.inputs),route:Object.keys(routeBuild.metafile.inputs),clientSha256:createHash('sha256').update(bundled.outputFiles[0].contents).digest('hex'),routeSha256:createHash('sha256').update(routeBuild.outputFiles[0].contents).digest('hex')},null,2));
 const widths=[];
 try{
  const opSession=[...sessions].find(([,v])=>v.role==='operator')[0];
  const cookies={cookie:'session='+opSession};
  const testBytes=await sharp({create:{width:17,height:18,channels:3,background:'#e91234'}}).jpeg().toBuffer();
  const intentRequest={op:'intent',requestId:randomUUID(),intentId:randomUUID(),sha256:createHash('sha256').update(testBytes).digest('hex'),byteSize:testBytes.length};
  const intentResponse=await fetch(origin+'/api/photo-finals/'+scope.bookingId,{method:'POST',headers:{...cookies,origin,'content-type':'application/json'},body:JSON.stringify(intentRequest)});assert.equal(intentResponse.status,200);
  const capBody=await intentResponse.json(),url=capBody.upload.url;
  const put=async(bytes,extra={})=>fetch(url,{method:'PUT',headers:{...cookies,...capBody.upload.headers,...extra},body:bytes});
  assert.equal((await put(testBytes,{'x-test-sha256':'0'.repeat(64)})).status,403);
  assert.equal((await put(testBytes,{cookie:'session='+[...sessions].find(([,v])=>v.role==='wrong')[0]})).status,403);
  assert.equal((await put(Buffer.concat([testBytes,Buffer.from('oversize')]))).status,503);
  sql(`update profiles set archived_at=now() where id='${actorId}'`);assert.equal((await put(testBytes)).status,503);sql(`update profiles set archived_at=null where id='${actorId}'`);
  caps.get(new URL(url).pathname.split('/').pop()).expires=Date.now()-1;assert.equal((await put(testBytes)).status,403);
  const crossOrigin=await fetch(origin+'/api/photo-finals/'+scope.bookingId,{method:'POST',headers:{...cookies,origin:'https://wrong.example','content-type':'application/json'},body:'{}'});assert.equal(crossOrigin.status,403);

  for(const width of [320,390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:900}});
   await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
   const session=[...sessions].find(([,v])=>v.role==='operator')[0];await context.addCookies([{name:'session',value:session,url:origin}]);
   const page=await context.newPage();page.on('response',r=>{if(r.status()>=400)failedRequests.push({url:new URL(r.url()).pathname,status:r.status()});});
   await page.goto(origin);await page.getByLabel('Upload finished JPEGs',{exact:true}).waitFor();
   const buffers=await Promise.all([0,1].map(n=>sharp({create:{width:300,height:150,channels:3,background:{r:width%255,g:n*90+20,b:width%121}}}).jpeg().toBuffer()));
   const files=buffers.map((buffer,n)=>({name:`synthetic-${width}-${n}.jpg`,mimeType:'image/jpeg',buffer}));
   failOnce=width===320?'intent':width===390?'complete':width===768?'put':'';
   await page.getByLabel('Upload finished JPEGs',{exact:true}).setInputFiles(files);
   if(width===320||width===390){await page.getByText('Photo finals could not be confirmed.',{exact:false}).waitFor();await page.reload();await page.getByLabel('Upload finished JPEGs',{exact:true}).waitFor();await page.getByLabel('Upload finished JPEGs',{exact:true}).setInputFiles(files);}
   await page.getByLabel('Select photo 2',{exact:true}).waitFor();
   await page.reload();await page.getByLabel('Upload finished JPEGs',{exact:true}).waitFor();await page.getByLabel('Upload finished JPEGs',{exact:true}).setInputFiles(files);
   await page.getByText('Photos remain private until approval and all packages are verified.',{exact:true}).waitFor();
   const latest=JSON.parse(sql(`select to_jsonb(b) from media_batches b where booking_id='${scope.bookingId}' order by created_at desc,id desc limit 1`));
   assert.equal(sql(`select count(*) from media_versions where batch_id='${latest.id}'`),'2','retry and reload must not duplicate accepted versions');
   await page.getByLabel('Select photo 2',{exact:true}).waitFor();await page.getByLabel('Select photo 1',{exact:true}).check();await page.getByLabel('Select photo 2',{exact:true}).check();
   for(const name of ['Delivery workspace','Another property']){
    page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');return dialog.dismiss();});await page.getByRole('link',{name,exact:true}).click();
    assert.equal(new URL(page.url()).search,'');assert.equal(await page.getByLabel('Select photo 1',{exact:true}).isChecked(),true);
   }
   await page.getByRole('button',{name:'Move photo 2 earlier',exact:true}).click();
   await page.getByRole('button',{name:'Save review order',exact:true}).click();await page.getByRole('button',{name:'Approve selected finals',exact:true}).waitFor();
   // Drafts are not customer-visible through the actual read handler.
   const realtorSession=[...sessions].find(([,v])=>v.role==='realtor')[0];
   const read=await fetch(origin+'/api/photo-finals/'+scope.bookingId,{headers:{cookie:'session='+realtorSession}});assert.equal((await read.json()).gallery,null);
   await page.getByRole('button',{name:'Approve selected finals',exact:true}).click();await page.getByRole('button',{name:'Prepare private packages',exact:true}).click();
   await page.getByRole('link',{name:'Full-resolution ZIP',exact:true}).waitFor();
   const zip=await context.request.get(origin+await page.getByRole('link',{name:'Full-resolution ZIP',exact:true}).getAttribute('href'));assert.equal(zip.status(),200);
   const downloaded=await zip.body();assert.equal(downloaded.readUInt32LE(0),0x04034b50);
   // Verify first STORE entry contains the second selected source, not merely a ZIP signature.
   const nameLength=downloaded.readUInt16LE(26),extraLength=downloaded.readUInt16LE(28),length=downloaded.readUInt32LE(18);assert.deepEqual(downloaded.subarray(30+nameLength+extraLength,30+nameLength+extraLength+length),buffers[1]);
   const operatorMetrics=await page.evaluate(()=>({innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.deepEqual(operatorMetrics,{innerWidth:width,client:width,scroll:width});
   const targets=await page.locator('button,a,input[type=file]').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width})));assert.ok(targets.every(t=>t.height>=44&&t.width>=44));
   await page.screenshot({path:out+`/operator-${width}.png`,fullPage:true});
   await context.addCookies([{name:'session',value:realtorSession,url:origin}]);await page.goto(origin+'/?role=realtor&iguide=1');await page.getByRole('img',{name:'Approved photo 2',exact:true}).waitFor();
   assert.equal(await page.getByLabel('Upload finished JPEGs',{exact:true}).count(),0);
   assert.equal(await page.getByRole('link',{name:'MLS export (provisional)',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'iGUIDE MLS',exact:true}).count(),1);
   const incumbent=await context.request.get(origin+'/test-only/iguide-unavailable');assert.equal(incumbent.status(),503);assert.equal(await page.getByRole('link',{name:'iGUIDE MLS',exact:true}).count(),1);
   const metrics=await page.evaluate(()=>({innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.deepEqual(metrics,{innerWidth:width,client:width,scroll:width});
   await page.getByRole('button',{name:'Enlarge photo 1',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'Photo preview',exact:true});await dialog.waitFor();
   await page.keyboard.press('ArrowRight');await dialog.getByRole('img',{name:'Approved photo 2',exact:true}).waitFor();
   await page.keyboard.press('Home');await dialog.getByRole('img',{name:'Approved photo 1',exact:true}).waitFor();
   const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=900);
   await page.screenshot({path:out+`/gallery-${width}.png`});
   for(let n=0;n<8;n++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true);}
   await page.keyboard.press('Shift+Tab');assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true);
   await page.setViewportSize({width,height:480});const short=await dialog.boundingBox();assert.ok(short.x>=0&&short.y>=0&&short.x+short.width<=width&&short.y+short.height<=480);await page.screenshot({path:out+`/gallery-short-${width}.png`});await page.setViewportSize({width,height:900});
   await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
   assert.equal(await page.getByRole('button',{name:'Enlarge photo 1',exact:true}).evaluate(n=>n===document.activeElement),true);
   await page.screenshot({path:out+`/realtor-${width}.png`,fullPage:true});widths.push({operator:operatorMetrics,realtor:metrics});
   failRead=true;await page.getByRole('button',{name:'Refresh photo status',exact:true}).click();await page.getByText('Photo finals could not be confirmed.',{exact:false}).waitFor();assert.equal(await page.getByRole('img',{name:'Approved photo 1',exact:true}).count(),0);failRead=false;
   await context.close();
  }
  // Revocation and wrong identities hit HTTP + actual service-role SQL, never mocks.
  const request=async(role,query='')=>fetch(origin+'/api/photo-finals/'+scope.bookingId+query,{headers:{cookie:'session='+[...sessions].find(([,v])=>v.role===role)[0]}});
  for(const role of ['wrong','tenant'])assert.notEqual((await request(role)).status,200);
  sql(`update profiles set archived_at=now() where id='${realtor}'`);assert.notEqual((await request('realtor')).status,200);sql(`update profiles set archived_at=null where id='${realtor}'`);
  const before=await (await request('realtor')).json();const download=before.gallery.downloads[0].url;
  sql(`update gallery_releases set state='withdrawn',withdrawn_at=now() where id='${before.gallery.releaseId}'`);
  assert.equal((await request('realtor')).status,200);assert.equal((await (await request('realtor')).json()).gallery,null);
  const denied=await fetch(origin+download,{headers:{cookie:'session='+[...sessions].find(([,v])=>v.role==='realtor')[0]}});assert.equal(denied.status,404);
  const proof={actualNextRouteExports:true,syntheticAuthAndFactoryOnly:true,widths,uploadCount,httpCount,capabilityWrongUserHeadersSizeExpiryRevocation:true,wrongUserTenantRevokedWithdrawn:true,iguideNotNetworkFallback:true,actualResponseError:true,failedRequests};await writeFile(out+'/proof.json',JSON.stringify(proof,null,2));return proof;
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));delete globalThis[bridgeKey];await rm(routeDirectory,{recursive:true,force:true});}
}
