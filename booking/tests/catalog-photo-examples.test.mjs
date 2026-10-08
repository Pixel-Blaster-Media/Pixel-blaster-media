import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import Renderer,{act} from 'react-test-renderer';
import {loadSource} from './helpers/source-module.mjs';
const policy=loadSource('lib/booking/catalog-upload-policy.ts');
const core=loadSource('lib/booking/catalog-examples-core.ts',{'./catalog-upload-policy.ts':policy});
const groups=loadSource('lib/booking/catalog-sample-groups.ts');
const viewer=loadSource('lib/booking/catalog-sample-viewer.ts');
function actions(){
 const writes=[],paths=[];
 const loaded=loadSource('app/admin/settings/pricing/example-actions.ts',{
  'next/cache':{revalidatePath:path=>paths.push(path)},
  '@/lib/booking/catalog-examples-core':core,
  '@/lib/booking/catalog-sample-viewer':viewer,
  '@/lib/booking/catalog-sample-groups':groups,
  '@/lib/auth/require-admin':{requireAdmin:async()=>({organizationId:'authorized-organization'})},
  '@/lib/supabase/server':{getServiceSupabase:()=>({rpc:async(name,args)=>{writes.push({name,args});return {data:'attached-example',error:null};}})},
 });return {...loaded,writes,paths};
}
function form(extra={}){const f=new FormData();for(const [k,v] of Object.entries({catalog_item_id:'service',title:'Living room',kind:'link',sample_group:'photos',external_url:'https://images.example.invalid/living.jpg',photo_sample:'true',photo_public_ack:'true',organization_id:'untrusted-organization',...extra}))f.set(k,v);return f;}
test('photo URL configuration requires admin scope and retains existing tenant-safe attachment RPC',async()=>{
 const a=actions();assert.equal((await a.attachCatalogExample(form())).ok,true);assert.equal(a.writes.length,1);
 assert.equal(a.writes[0].name,'attach_external_catalog_example');assert.equal(a.writes[0].args.p_organization_id,'authorized-organization');assert.equal(a.writes[0].args.p_kind,'link');assert.equal(a.writes[0].args.p_sample_group_key,'photos');assert.equal(a.writes[0].args.p_external_url,'https://images.example.invalid/living.jpg');assert.deepEqual(a.paths,['/admin/settings/pricing','/book']);
});
test('photo-specific form rejects unsafe/indirect URLs and missing public permission before writing',async()=>{
 for(const extra of [{photo_public_ack:'false'},{external_url:'https://images.example.invalid/album'},{external_url:'https://images.example.invalid/p.svg'},{external_url:'https://127.0.0.1/p.jpg'},{sample_group:'custom',custom_sample_group_label:'Other'},{kind:'interactive'}]){const a=actions();assert.equal((await a.attachCatalogExample(form(extra))).ok,false);assert.equal(a.writes.length,0);}
});
test('admin editor exposes configurable empty photo gallery and submits explicit public photo fields',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const sent=[];const MockUploader=()=>null;
 const Editor=loadSource('app/admin/settings/pricing/CatalogExamplesEditor.tsx',{
  react:React,'react/jsx-runtime':jsxRuntime,'./CatalogVideoUploader':{default:MockUploader},'next/navigation':{useRouter:()=>({refresh(){}})},
  '@/lib/booking/catalog-sample-groups':groups,
  '@/lib/booking/catalog-video-completion':{waitForCatalogVideoCompletion:async()=>{throw Error('Photo editing must not check videos');}},
  './example-actions':{attachCatalogExample:async f=>{sent.push(Object.fromEntries(f));return {ok:true};},attachSharedCatalogVideo:async()=>({ok:true}),deleteCatalogExample:async()=>({ok:true}),removeSharedCatalogVideoPlacement:async()=>({ok:true})},
 },{FormData}).default;let tree;
 try{
  await act(async()=>{tree=Renderer.create(React.createElement(Editor,{catalogItemId:'service',examples:[],reusableVideos:[],streamConfigured:true}));});
  const text=node=>JSON.stringify(node.children);
  await act(async()=>tree.root.findAllByType('button').find(b=>text(b).includes('Add photo URL')).props.onClick());
  const inputs=tree.root.findAllByType('input');await act(async()=>{inputs.find(i=>i.props.placeholder==='Living room').props.onChange({target:{value:'Living room'}});inputs.find(i=>i.props.type==='url').props.onChange({target:{value:'https://images.example.invalid/living.jpg'}});inputs.find(i=>i.props.type==='checkbox').props.onChange({target:{checked:true}});});
  const options=tree.root.findAllByType('option').map(o=>o.props.value);assert.deepEqual(options,['photos','aerial']);
  await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});});
  assert.equal(sent.length,1);assert.equal(sent[0].kind,'link');assert.equal(sent[0].sample_group,'photos');assert.equal(sent[0].photo_sample,'true');assert.equal(sent[0].photo_public_ack,'true');assert.equal(sent[0].title,'Living room');
  await act(async()=>tree.root.findAllByType('button').find(b=>text(b).includes('Add photo URL')).props.onClick());
  await act(async()=>tree.root.findAllByType('button').find(b=>text(b).includes('Upload video')).props.onClick());
  assert.equal(tree.root.findByType(MockUploader).props.catalogItemId,'service');
  assert.equal(tree.root.findAllByType('input').filter(i=>i.props.type==='checkbox').length,0);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
