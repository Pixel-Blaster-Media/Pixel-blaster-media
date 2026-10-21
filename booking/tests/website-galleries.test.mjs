import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {loadSource} from './helpers/source-module.mjs';
import {websiteGalleries,galleryDependencies} from './helpers/website-gallery-source.mjs';

const {WEBSITE_GALLERIES,websiteGallery}=websiteGalleries;
test('six exact HTTPS collection routes are recognized; arbitrary links cannot enter the gallery',()=>{
 assert.equal(WEBSITE_GALLERIES.length,6);
 for(const gallery of WEBSITE_GALLERIES){
  assert.equal(websiteGallery(gallery.url),gallery);
  assert.equal(websiteGallery(gallery.url.replace('://pixel', '://www.pixel')),gallery);
  for(const bad of [gallery.url.replace('https:','http:'),gallery.url.replace('.com/','.com.attacker.invalid/'),gallery.url.replace('://','://user:pass@'),gallery.url.replace('.com/','.com:8443/'),gallery.url.replace('/#','/?redirect=elsewhere#'),gallery.url.replace('/#','/book#'),gallery.url+'/extra',gallery.url+'?x=1'])assert.equal(websiteGallery(bad),undefined,bad);
 }
 for(const value of [null,'','garbage','javascript:alert(1)','https://pixelblastermedia.com/#gallery/unknown'])assert.equal(websiteGallery(value),undefined);
});
test('metadata uses all existing photos in canonical section order with the approved fireplace first',()=>{
 execFileSync(process.execPath,['scripts/sync-website-galleries.mjs','--check'],{cwd:new URL('..',import.meta.url)});
 const p=JSON.parse(readFileSync(new URL('../../portfolio.js',import.meta.url),'utf8').replace(/^const portfolio = /,'').replace(/;\s*$/,''));
 assert.equal(WEBSITE_GALLERIES.reduce((n,g)=>n+g.count,0),97);
 for(const collection of Object.values(p.collections)){
  const gallery=websiteGallery(`https://pixelblastermedia.com/#gallery/${collection.slug}`);
  assert.deepEqual(gallery.sections.flatMap(s=>s.photos.map(p=>p.id)),(collection.sections??[{photos:collection.photos}]).flatMap(s=>s.photos.map(String)));
  for(const photo of gallery.sections.flatMap(s=>s.photos)){
   assert.ok(photo.alt);assert.ok(photo.width>0&&photo.height>0);
   assert.equal(photo.src,`https://pixelblastermedia.com/${p.photos[photo.id].variants.at(-1).src}`);
  }
 }
 assert.equal(websiteGallery('https://pixelblastermedia.com/#gallery/interiors-architecture').sections[0].photos[0].id,'80');
});
test('gallery validation keeps the authenticated existing RPC and rejects the mistaken single-image path without writes',async()=>{
 const writes=[];
 const policy=loadSource('lib/booking/catalog-upload-policy.ts');
 const core=loadSource('lib/booking/catalog-examples-core.ts',{'./catalog-upload-policy.ts':policy});
 const actions=loadSource('app/admin/settings/pricing/example-actions.ts',{
  ...galleryDependencies,'next/cache':{revalidatePath(){}},'@/lib/booking/catalog-examples-core':core,
  '@/lib/booking/catalog-sample-viewer':loadSource('lib/booking/catalog-sample-viewer.ts'),
  '@/lib/booking/catalog-sample-groups':loadSource('lib/booking/catalog-sample-groups.ts'),
  '@/lib/auth/require-admin':{requireAdmin:async()=>({organizationId:'authorized'})},
  '@/lib/supabase/server':{getServiceSupabase:()=>({rpc:async(name,args)=>{writes.push({name,args});return {data:'id',error:null};}})},
 });
 const form=(gallery,extra={})=>{const f=new FormData();for(const[k,v]of Object.entries({catalog_item_id:'service',title:gallery.label,kind:'link',sample_group:'photos',external_url:gallery.url,gallery_sample:'true',...extra}))f.set(k,v);return f;};
 for(const gallery of WEBSITE_GALLERIES)assert.equal((await actions.attachCatalogExample(form(gallery))).ok,true);
 assert.equal(writes.length,6);assert.ok(writes.every(w=>w.name==='attach_external_catalog_example'&&w.args.p_organization_id==='authorized'&&w.args.p_kind==='link'&&w.args.p_sample_group_key==='photos'));
 for(const extra of [{external_url:'https://example.invalid/album'},{kind:'video'},{sample_group:'iguide'}])assert.equal((await actions.attachCatalogExample(form(WEBSITE_GALLERIES[0],extra))).ok,false);
 const mistaken=await actions.attachCatalogExample(form(WEBSITE_GALLERIES[0],{photo_sample:'true',photo_public_ack:'true'}));
 assert.equal(mistaken.ok,false);assert.match(mistaken.error,/website gallery/);assert.equal(writes.length,6);
 const legacy=form(WEBSITE_GALLERIES[0]);legacy.delete('gallery_sample');assert.equal((await actions.attachCatalogExample(legacy)).ok,true);
});
