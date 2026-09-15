// TEST ONLY: actual action/template/selector, actual finals PG reader. No transport.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {build} from 'esbuild';
export async function deliveryProof({db,storage,env,scope,actorId,sql,state}){
 const file=resolve('app/admin/bookings/[id]/actions.ts');
 const ast=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
 const imports=new Map();for(const node of ast.statements){if(!ts.isImportDeclaration(node)||!node.importClause||node.importClause.isTypeOnly)continue;const bindings=node.importClause.namedBindings;if(bindings&&ts.isNamedImports(bindings))imports.set(node.moduleSpecifier.text,bindings.elements.filter(n=>!n.isTypeOnly).map(n=>(n.propertyName??n.name).text));}
 const real=new Set(['@/lib/booking/delivery-links','@/lib/media/finals/delivery','@/lib/media/finals/application','@/lib/email/templates']);
 const sent=[];let withdraw=false,reads=0,disabled=false;
 const video={id:randomUUID(),type:'video',source:'manual',url:'https://example.invalid/video',metadata:null,ready_at:'2026-01-01'};
 const iguide={id:randomUUID(),type:'photo_gallery',source:'iguide',url:'https://youriguide.com/synthetic',metadata:{mls_photo_zip_url:'https://youriguide.com/synthetic/doc/gallery-low-res.zip'},ready_at:'2026-01-01'};
 let deliverables=[video];
 const booking={id:scope.bookingId,property_id:scope.propertyId,quickbooks_invoice_url:'https://example.invalid/invoice',properties:{street_address:'Synthetic shoot'},profiles:{email:'realtor@example.invalid',full_name:'Synthetic Realtor',delivery_cc_emails:[]}};
 const service={from(table){const q={select(){return q},eq(){return q},not(){return q},async single(){return {data:booking,error:null}},async maybeSingle(){return {data:table==='bookings'?booking:null,error:null}},async returns(){return {data:deliverables,error:null}},async upsert(){return {error:null}}};return q;}};
 const bridge={requireAdmin:async()=>({userId:actorId,organizationId:scope.organizationId,email:'operator@example.invalid'}),getServiceSupabase:()=>service,createProductionFinalsRuntime:async()=>{reads++;return disabled?null:{db,storage,env};},getOrganizationEmailSettings:async()=>{if(withdraw)sql(`update gallery_releases set state='withdrawn',withdrawn_at=now() where id='${state.gallery.releaseId}'`);return {invoiceTiming:'on_delivery'};},sendEmail:async value=>{sent.push(value);return {ok:true};},sendPushBestEffort:async()=>{},revalidatePath:()=>{}};
 const name='__PF_EMAIL_'+randomUUID().replaceAll('-','');globalThis[name]=bridge;
 const directory=resolve('node_modules/.cache/'+name);await mkdir(directory,{recursive:true});
 const result=await build({stdin:{contents:`export {sendDeliveryReadyEmail} from ${JSON.stringify(file)};`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',packages:'external',plugins:[{name:'explicit-test-only-action-boundaries',setup(build){build.onResolve({filter:/^@\/lib\/booking\/availability$/},args=>args.importer.endsWith('/lib/email/templates.ts')?{path:resolve('lib/booking/timezone.ts')}:null);build.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty'}));build.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));build.onResolve({filter:/.*/},args=>args.importer===file&&imports.has(args.path)&&!real.has(args.path)?{path:args.path,namespace:'fixture'}:null);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:imports.get(args.path).map(n=>`export const ${n}=(...a)=>{const f=globalThis.${name}.${n};if(!f)throw Error('Unexpected action side effect: ${n}');return f(...a)};`).join('\n')}));}}]});
 const target=resolve(directory,'action.mjs');await writeFile(target,result.outputFiles[0].contents);
 const old=process.env.NEXT_PUBLIC_APP_URL;process.env.NEXT_PUBLIC_APP_URL='https://pixel.example.invalid';
 try{
  const {sendDeliveryReadyEmail}=await import(pathToFileURL(target));
  assert.equal((await sendDeliveryReadyEmail(scope.bookingId)).ok,true);assert.equal(sent.length,1);assert.equal(reads,2);
  for(const link of state.gallery.downloads)assert.ok(sent[0].html.includes('https://pixel.example.invalid'+link.url),'actual rendered email includes exact fresh package URL');
  assert.ok(sent[0].html.includes(video.url));assert.ok(sent[0].html.includes(booking.quickbooks_invoice_url));
  disabled=true;assert.equal((await sendDeliveryReadyEmail(scope.bookingId)).ok,true);assert.ok(!sent[1].html.includes('/api/photo-finals/'),'nonactivating factory preserves video-only delivery');
  disabled=false;deliverables=[iguide,video];assert.equal((await sendDeliveryReadyEmail(scope.bookingId)).ok,true);
  assert.ok(sent[2].html.includes(encodeURIComponent(iguide.metadata.mls_photo_zip_url)));assert.ok(!sent[2].html.includes(state.gallery.downloads.find(d=>d.slot==='photos_mls').url));assert.ok(sent[2].html.includes(state.gallery.downloads.find(d=>d.slot==='photos_full_res').url));
  withdraw=true;assert.equal((await sendDeliveryReadyEmail(scope.bookingId)).ok,true);assert.ok(!sent[3].html.includes('/api/photo-finals/'),'withdrawal during billing is excluded by second fresh SQL read');assert.ok(sent[3].html.includes(video.url));
  return {actualActionAndTemplate:true,actualCurrentStatePG:true,mockedEmailCount:sent.length,noRealEmails:true,freshAfterBillingWithdrawal:true,videoOnlyAndInvoicePreserved:true};
 }finally{if(old===undefined)delete process.env.NEXT_PUBLIC_APP_URL;else process.env.NEXT_PUBLIC_APP_URL=old;delete globalThis[name];await rm(directory,{recursive:true,force:true});}
}
