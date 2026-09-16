// Test-only real Next App Router process. Production components are imported by
// absolute path. The API transport bridges to the separate actual-route/PG server;
// this does NOT substitute fake finals data or enable synthetic production auth.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
export async function nextRouterProof({browser,backend,session,bookingId,secondBookingId,alternateSession,out,css}){
 const root=resolve('/tmp/pf-next-'+randomUUID());await mkdir(root+'/app/api/photo-finals/[bookingId]',{recursive:true});await symlink(resolve('node_modules'),root+'/node_modules','dir');
 const components=resolve('components/media'),lib=resolve('lib');
 const put=(name,contents)=>writeFile(root+'/'+name,contents);
 await put('package.json',JSON.stringify({private:true,scripts:{},dependencies:{next:'*',react:'*','react-dom':'*'}}));
 await put('next.config.mjs',`export default {devIndicators:false,experimental:{externalDir:true},webpack(c){c.resolve.alias['@/lib']=${JSON.stringify(lib)};return c;}};`);
 await put('app/fixture.css',css+'\nmain{max-width:1000px;margin:auto;padding:12px}main>a,main>button{display:inline-flex;min-height:44px;align-items:center;margin:4px}');
 await put('app/layout.jsx',`import './fixture.css';import Owner from ${JSON.stringify(components+'/FinalsNavigationOwner.tsx')};export default function Layout({children}){return <html><body><main><p>TEST ONLY: real Next router; synthetic PG/session API bridge</p><Owner>{children}</Owner></main></body></html>}`);
 await put('app/page.jsx',`'use client';import {useRouter,useSearchParams} from 'next/navigation';import Link from 'next/link';import Workspace from ${JSON.stringify(components+'/PhotoFinalsWorkspace.tsx')};export default function Page(){const router=useRouter(),q=useSearchParams();return <><p data-testid="route">{q.get('view')||'photos'}</p><Link href="/?view=photos">Photos route</Link><Link href="/?view=other">Other route</Link><Link href="/?view=second">Property B</Link><button onClick={()=>router.push('/?view=other')}>Programmatic switch</button>{q.get('view')!=='other'&&<Workspace bookingId={q.get('view')==='second'?${JSON.stringify(secondBookingId)}:${JSON.stringify(bookingId)}} operator/>}</>}`);
 await put('app/api/photo-finals/[bookingId]/route.js',`const backend=${JSON.stringify(backend)};async function forward(request,{params}){const {bookingId}=await params;const url=new URL(request.url);const headers=new Headers(request.headers);headers.set('origin',backend);headers.delete('host');headers.delete('content-length');const response=await fetch(backend+'/api/photo-finals/'+bookingId+url.search,{method:request.method,headers,...(request.method==='POST'?{body:await request.text()}:{}),cache:'no-store'});return new Response(response.body,{status:response.status,headers:response.headers});}export const GET=forward;export const POST=forward;`);
 const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','-H','127.0.0.1','-p','0'],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>{log+=b});child.stderr.on('data',b=>{log+=b});
 let context;
 try{
  const origin=await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>{clearInterval(timer);reject(new Error('Next startup timeout: '+log));},90000);const timer=setInterval(()=>{const match=log.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(deadline);clearInterval(timer);resolve(match[0]);}else if(child.exitCode!==null){clearTimeout(deadline);clearInterval(timer);reject(new Error(log));}},100)});
  context=await browser.newContext({viewport:{width:390,height:900}});await context.addCookies([{name:'session',value:session,url:origin}]);const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByLabel('Select photo 1',{exact:true}).waitFor({timeout:90000});
  await page.getByRole('link',{name:'Other route',exact:true}).click();await page.getByTestId('route').filter({hasText:'other'}).waitFor();
  await page.getByRole('link',{name:'Photos route',exact:true}).click();await page.getByLabel('Select photo 1',{exact:true}).check();
  let prompts=0;page.on('dialog',async d=>{prompts++;await d.dismiss();});
  await page.getByRole('button',{name:'Programmatic switch',exact:true}).click();
  await page.waitForTimeout(500);assert.equal(new URL(page.url()).search,'?view=photos','programmatic dirty navigation must keep URL');assert.equal(await page.getByLabel('Select photo 1',{exact:true}).isChecked(),true);
  await page.evaluate(()=>history.back());await page.waitForTimeout(500);assert.equal(new URL(page.url()).search,'?view=photos','cancel back must restore URL');assert.equal(await page.getByLabel('Select photo 1',{exact:true}).isChecked(),true);
  assert.equal(prompts,2);
  await page.getByLabel('Select photo 1',{exact:true}).uncheck();await page.getByRole('link',{name:'Other route',exact:true}).click();await page.getByTestId('route').filter({hasText:'other'}).waitFor();
  await page.evaluate(()=>history.back());await page.getByLabel('Select photo 1',{exact:true}).check();
  await page.evaluate(()=>history.forward());await page.waitForTimeout(500);assert.equal(new URL(page.url()).search,'?view=photos','cancel forward must restore URL');assert.equal(await page.getByLabel('Select photo 1',{exact:true}).isChecked(),true);assert.equal(prompts,3);
  await page.getByLabel('Select photo 1',{exact:true}).uncheck();
  let releaseRead,readStarted;const readHeld=new Promise(r=>{releaseRead=r}),readReady=new Promise(r=>{readStarted=r});
  await page.route('**/api/photo-finals/'+secondBookingId,async route=>{const response=await route.fetch();readStarted();await readHeld;await route.fulfill({response}).catch(()=>{});});
  await page.getByRole('link',{name:'Property B',exact:true}).click();await readReady;assert.equal(await page.getByLabel('Select photo 2',{exact:true}).count(),0,'previous property cannot remain editable while B loads');
  await page.getByRole('link',{name:'Photos route',exact:true}).click();await page.getByLabel('Select photo 2',{exact:true}).waitFor();releaseRead();await page.waitForTimeout(500);assert.equal(await page.getByLabel('Select photo 2',{exact:true}).count(),1);await page.unroute('**/api/photo-finals/'+secondBookingId);await page.getByLabel('Select photo 1',{exact:true}).check();
  // Delay the response AFTER the real SQL save commits, then leave the editor.
  let releaseSave,saveCommitted;const held=new Promise(r=>{releaseSave=r}),committed=new Promise(r=>{saveCommitted=r});let saved;
  await page.route('**/api/photo-finals/*',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().op==='prepare'){const response=await route.fetch();assert.equal(response.status(),200);saved=await response.json();saveCommitted();await held;await route.fulfill({response});}else await route.continue();});
  await page.getByRole('button',{name:'Save review order',exact:true}).click();await committed;
  page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());
  await page.getByRole('link',{name:'Property B',exact:true}).click();await page.getByTestId('route').filter({hasText:'second'}).waitFor();await page.getByLabel('Select photo 1',{exact:true}).waitFor();releaseSave();await page.waitForTimeout(500);
  assert.equal(new URL(page.url()).search,'?view=second');assert.equal(await page.getByLabel('Select photo 2',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Approve selected finals',exact:true}).count(),0);
  const secondState=await (await context.request.get(origin+'/api/photo-finals/'+secondBookingId)).json();assert.equal(secondState.release,null);assert.equal(secondState.versions.length,1);
  const persisted=await (await context.request.get(origin+'/api/photo-finals/'+bookingId)).json();assert.equal(persisted.release.id,saved.id);
  await page.getByRole('link',{name:'Photos route',exact:true}).click();await page.getByLabel('Select photo 1',{exact:true}).waitFor();assert.equal(await page.getByLabel('Select photo 1',{exact:true}).isChecked(),false);assert.equal(await page.getByRole('button',{name:'Approve selected finals',exact:true}).count(),0);
  await page.unroute('**/api/photo-finals/*');
  let releaseSessionSave,sessionSaveStarted;const sessionHeld=new Promise(r=>{releaseSessionSave=r}),sessionReady=new Promise(r=>{sessionSaveStarted=r});
  await page.route('**/api/photo-finals/*',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().op==='prepare'){const response=await route.fetch();assert.equal(response.status(),200);saved=await response.json();sessionSaveStarted();await sessionHeld;await route.fulfill({response});}else await route.continue();});
  await page.getByLabel('Select photo 1',{exact:true}).check();await page.getByRole('button',{name:'Save review order',exact:true}).click();await sessionReady;
  await context.addCookies([{name:'session',value:alternateSession,url:origin}]);releaseSessionSave();await page.waitForTimeout(750);
  assert.equal(await page.getByRole('button',{name:'Approve selected finals',exact:true}).count(),0,'a saved receipt must not cross a session switch during refresh');
  await page.unroute('**/api/photo-finals/*');await context.addCookies([{name:'session',value:session,url:origin}]);await page.reload();await page.getByLabel('Select photo 1',{exact:true}).check();
  await context.addCookies([{name:'session',value:alternateSession,url:origin}]);
  const refused=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/photo-finals/'));await page.getByRole('button',{name:'Save review order',exact:true}).click();assert.equal((await refused).status(),409);
  await page.getByText('Photo finals could not be confirmed.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Approve selected finals',exact:true}).count(),0);
  await context.addCookies([{name:'session',value:session,url:origin}]);const unchanged=await (await context.request.get(origin+'/api/photo-finals/'+bookingId)).json();assert.equal(unchanged.release.id,saved.id);
  await page.reload();await page.getByLabel('Select photo 1',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>({width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})),{width:390,client:390,scroll:390});
  await page.screenshot({path:out+'/next-router-390.png',fullPage:true});
  return {realNextAppRouter:true,syntheticApiBridge:true,programmaticDirtyCancel:true,historyBackCancel:true,historyForwardCancel:true,delayedPropertyReadFenced:true,delayedSavePropertyTargetPreserved:true,sessionSwitchRejectsMutation:true,sessionSwitchDropsOldReceipt:true};
 }finally{if(context)await context.close();child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await writeFile(out+'/next-router.log',log);await rm(root,{recursive:true,force:true});}
}
