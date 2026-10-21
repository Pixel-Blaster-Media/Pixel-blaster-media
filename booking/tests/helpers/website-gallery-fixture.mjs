// Real editor, server validation, booking picker and dialog; only auth/storage/navigation are local fixtures.
import http from 'node:http';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {loadSource} from './source-module.mjs';
import {galleryDependencies} from './website-gallery-source.mjs';

export async function startGalleryFixture() {
 const root=path.resolve(import.meta.dirname,'../..');
 let examples=[],writes=0;
 const policy=loadSource('lib/booking/catalog-upload-policy.ts');
 const core=loadSource('lib/booking/catalog-examples-core.ts',{'./catalog-upload-policy.ts':policy});
 const actions=loadSource('app/admin/settings/pricing/example-actions.ts',{
  ...galleryDependencies,'next/cache':{revalidatePath(){}},'@/lib/booking/catalog-examples-core':core,
  '@/lib/booking/catalog-sample-viewer':loadSource('lib/booking/catalog-sample-viewer.ts'),
  '@/lib/booking/catalog-sample-groups':loadSource('lib/booking/catalog-sample-groups.ts'),
  '@/lib/auth/require-admin':{requireAdmin:async()=>({organizationId:'fixture-org'})},
  '@/lib/supabase/server':{getServiceSupabase:()=>({rpc:async(name,args)=>{
   if(name!=='attach_external_catalog_example'||args.p_organization_id!=='fixture-org'||examples.length>=8) return {data:null,error:'fixture constraint'};
   const id=`example-${++writes}`;
   examples.push({id,catalog_item_id:'fixture',source_example_id:id,source_type:'external',status:'ready',active:true,
    title:args.p_title,description:args.p_description,kind:args.p_kind,sample_group_key:args.p_sample_group_key,sample_group_label:args.p_sample_group_label,
    external_url:args.p_external_url,embed_url:null,orientation:'landscape'});
   return {data:id,error:null};
  }})},
 });
 const bundle=await build({
  stdin:{resolveDir:root,loader:'tsx',contents:`
   import React from 'react';import {createRoot} from 'react-dom/client';
   import Editor from './app/admin/settings/pricing/CatalogExamplesEditor';
   import Picker from './app/book/_components/PackageAccordion';
   import {useSearchParams} from 'next/navigation';
   const base={id:'fixture',slug:'blue-print',name:'Blue Print fixture',kind:'bundle',description:'Listing photographs\\nFloor plans',duration_minutes:60,price_cents:25000,sqft_pricing_enabled:false,is_photo:true,is_iguide:true,is_video:false,is_aerial:false,video_overage_price_cents:0};
   const legacy=[
    {id:'photo',title:'Individual photo',kind:'link',sample_group_key:'photos',external_url:'https://pixelblastermedia.com/assets/portfolio/stone-timber-fireplace-640.webp'},
    {id:'tour',title:'Tour fixture',kind:'interactive',sample_group_key:'iguide',external_url:'https://youriguide.com/fixture_tour'},
    {id:'video',title:'Video fixture',kind:'video',sample_group_key:'video',embed_url:'https://customer-example.cloudflarestream.com/ae26683a8919895dabdb9b102e5679d3/iframe'},
    {id:'external',title:'External album',kind:'link',sample_group_key:'photos',external_url:'https://example.invalid/album'}
   ].map(e=>({description:null,external_url:null,embed_url:null,orientation:'landscape',...e,sample_group_label:({photos:'Photos',iguide:'iGUIDE',video:'Video'})[e.sample_group_key]}));
   function App(){const params=useSearchParams();const [examples,setExamples]=React.useState(window.fixtureExamples);
    React.useEffect(()=>{const update=()=>fetch('/examples').then(r=>r.json()).then(setExamples);window.addEventListener('fixture-refresh',update);return()=>window.removeEventListener('fixture-refresh',update)},[]);
    return <main><p>Local test fixture — no live service settings</p><nav><a href='/editor'>Editor fixture</a> · <a href='/book?draft=fixture-draft&services=blue-print&add_ons=extra&slot=kept'>Booking fixture</a></nav>
     {location.pathname==='/editor'?<Editor catalogItemId='fixture' examples={examples} reusableVideos={[]} streamConfigured={true}/>:
      <><label>Unsaved booking note<input defaultValue='Keep this booking note' /></label><Picker bundles={[{...base,examples}]}
       aLaCarte={[{...base,id:'legacy',slug:'legacy',name:'Other example types',kind:'a_la_carte',is_video:true,examples:legacy}]}
       addons={[{...base,id:'extra',slug:'extra',name:'Extra fixture',kind:'addon',examples:[]}]}
       selectedSlugs={(params.get('services')??'').split(',')} selectedAddOnSlugs={(params.get('add_ons')??'').split(',')}
       squareFootage={1800} includeBasement={true}/></>}
    </main>}
   createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty'},tsconfig:path.join(root,'tsconfig.json'),logLevel:'warning',
  plugins:[{name:'local-boundaries',setup(b){
   b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
   b.onResolve({filter:/(?:^|\/)example-actions$/},()=>({path:'actions',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},({path:name})=>({resolveDir:root,contents:name==='navigation'?`
    import {useSyncExternalStore} from 'react';
    const subscribe=cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)};
    export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));
    export const useRouter=()=>({refresh(){window.dispatchEvent(new Event('fixture-refresh'))},replace(url){history.replaceState(null,'',url);window.dispatchEvent(new Event('popstate'))}});
   `:`
    export async function attachCatalogExample(form){return fetch('/attach',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(form))}).then(r=>r.json())}
    const reject=async()=>{throw Error('Unsupported fixture mutation')};export const attachSharedCatalogVideo=reject,deleteCatalogExample=reject,removeSharedCatalogVideoPlacement=reject;
   `}));
  }}],
 });
 const tailwind=execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','app/globals.css'],{cwd:root,encoding:'utf8',maxBuffer:8_000_000,stdio:['ignore','pipe','pipe']});
 const css=tailwind+'\n'+readFileSync(path.join(root,'app/book/booking-refresh.css'),'utf8')+'\n'+readFileSync(path.join(root,'components/website-gallery.css'),'utf8');
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text)}
  if(pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');return res.end(css)}
  if(pathname==='/examples'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(examples))}
  if(pathname==='/attach'&&req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   const form=new FormData();for(const[k,v]of Object.entries(JSON.parse(body)))form.set(k,v);
   res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(await actions.attachCatalogExample(form)));
  }
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{padding:16px;background:#f4f7f2;font-family:system-ui}main{max-width:1152px;margin:auto}nav{margin:16px 0}nav a{text-decoration:underline}main>label{display:block;margin:16px 0}</style></head><body><div id="root"></div><script>window.fixtureExamples=${JSON.stringify(examples).replaceAll('<','\\u003c')}</script><script src="/fixture.js"></script></body></html>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {origin:`http://127.0.0.1:${server.address().port}`,root,getWrites:()=>writes,reset(){examples=[];writes=0},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}};
}
if(process.env.GALLERY_FIXTURE_SERVE==='1'){
 const fixture=await startGalleryFixture();console.log(`Gallery fixture ready: ${fixture.origin}/editor`);
}
