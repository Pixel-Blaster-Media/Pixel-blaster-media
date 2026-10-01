import assert from 'node:assert/strict';
import test from 'node:test';
import * as jsxRuntime from 'react/jsx-runtime';
import { loadSource } from './helpers/source-module.mjs';

const org = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const propertyId = '33333333-3333-4333-8333-333333333333';
const bookingId = '44444444-4444-4444-8444-444444444444';
const draftId = '55555555-5555-4555-8555-555555555555';
const clone = value => JSON.parse(JSON.stringify(value));
function fixture({ role='realtor', propertyOverrides={}, bookingOverrides={}, hasBooking=true, savedError=null }={}) {
  const queries=[],saved=[];
  const user={userId:owner,organizationId:org,role};
  const property={id:propertyId,organization_id:org,owner_id:owner,street_address:'123 Private Rebook Street',city:'Hamilton',postal_code:'L8P 4S8',...propertyOverrides};
  const booking={id:bookingId,property_id:propertyId,organization_id:org,owner_id:owner,services:['video_tour','residential_photography'],add_ons:['aerial_add_on'],square_footage:2501,unit_number:'4B',client_notes:'OLD ACCESS CODE',...bookingOverrides};
  function client(scope) { return { from(table) {
    const call={scope,table,filters:[],selected:null};queries.push(call);
    const q={select(columns){call.selected=columns;return q;},eq(key,value){call.filters.push([key,value]);return q;},order(){return q;},limit(){return q;},async maybeSingle(){
      const row=table==='properties'?property:table==='bookings'?(hasBooking?booking:null):table==='organizations'?{id:org,slug:'company'}:undefined;
      assert.notEqual(row,undefined,`Unexpected table ${table}`);
      return {data:row&&call.filters.every(([key,value])=>row[key]===value)?row:null,error:null};
    }};return q;
  }}; }
  const dependencies={
    'next/navigation':{notFound(){throw new Error('NOT_FOUND');},redirect(url){throw Object.assign(new Error('REDIRECT'),{url});}},
    '@/lib/auth/require-user':{requireUser:async()=>user},
    '@/lib/supabase/server':{getServerSupabase:async()=>client('session'),getServiceSupabase:()=>client('service')},
    '@/app/book/draft-actions':{saveBookingWizardDraft:async input=>{saved.push(clone(input));return savedError?{ok:false,error:savedError}:{ok:true,query:input.query+'&draft='+draftId};}},
  };
  const action=loadSource('app/portal/book/actions.ts',dependencies).startSimilarBooking;
  const page=loadSource('app/portal/book/page.tsx',{...dependencies,'react/jsx-runtime':jsxRuntime,'./RebookForm':{default:()=>null}}).default;
  const form=new FormData();form.set('property_id',propertyId);form.set('booking_id',bookingId);
  return {action,page,form,queries,saved};
}

test('owned rebooking resolves private prefill on the server and redirects with IDs/selections only',async()=>{
  const f=fixture();f.form.set('street_address','ATTACKER PROPERTY');f.form.set('shoot_notes','ATTACKER SECRET');
  await assert.rejects(()=>f.action(null,f.form),error=>{
    const url=new URL(error.url,'https://example.invalid');
    assert.equal(url.pathname,'/book/property');
    assert.deepEqual([...url.searchParams.keys()].sort(),['add_ons','draft','org','services']);
    assert.equal(url.searchParams.get('draft'),draftId);
    assert.doesNotMatch(url.href,/Private|ACCESS|ATTACKER/);return true;
  });
  assert.deepEqual(f.saved,[{query:'org=company&services=video_tour%2Cresidential_photography&add_ons=aerial_add_on',property:{streetAddress:'123 Private Rebook Street',city:'Hamilton',postalCode:'L8P 4S8',unitNumber:'4B',squareFootage:2501,isVacant:null,includeBasement:null,shotRequests:[],shootNotes:''}}]);
  for(const table of ['properties','bookings']) {
    const query=f.queries.find(q=>q.table===table);
    assert.equal(query.scope,'session');
    assert.ok(query.filters.some(([k,v])=>k==='organization_id'&&v===org));
    assert.ok(query.filters.some(([k,v])=>k==='owner_id'&&v===owner));
    assert.doesNotMatch(query.selected,/notes|vacant|basement/);
  }
  assert.deepEqual(f.queries.find(q=>q.table==='organizations').filters,[['id',org]]);
});

for(const [name,options] of [
  ['another owner',{propertyOverrides:{owner_id:bookingId}}],
  ['another tenant',{propertyOverrides:{organization_id:bookingId}}],
  ['another property booking',{bookingOverrides:{property_id:bookingId}}],
  ['another booking owner',{bookingOverrides:{owner_id:bookingId}}],
  ['another booking tenant',{bookingOverrides:{organization_id:bookingId}}],
  ['missing selected booking',{hasBooking:false}],
  ['non-realtor account',{role:'admin'}],
]) test(`rebooking rejects ${name} before writing a draft`,async()=>{
  const f=fixture(options);await assert.rejects(()=>f.action(null,f.form),/NOT_FOUND/);assert.deepEqual(f.saved,[]);
});

test('property with no prior booking can start a fresh private flow',async()=>{
  const f=fixture({hasBooking:false});f.form.delete('booking_id');
  await assert.rejects(()=>f.action(null,f.form),error=>error.url===`/book?org=company&draft=${draftId}`);
  assert.equal(f.saved[0].property.squareFootage,null);
});

test('private draft write failure stays recoverable on the portal',async()=>{
  const f=fixture({savedError:'Please try again.'});assert.deepEqual(clone(await f.action(null,f.form)),{error:'Please try again.'});
});

test('legacy rebook URLs strip private fields before explicit POST and never write on GET',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.page({searchParams:Promise.resolve({from_property:propertyId,from_booking:bookingId,address:'private',shoot_notes:'SECRET',slot:'old'})}),error=>error.url===`/portal/book?from_property=${propertyId}&from_booking=${bookingId}`);
  const tree=await f.page({searchParams:Promise.resolve({from_property:propertyId,from_booking:bookingId})});
  assert.doesNotMatch(JSON.stringify(tree),/street_address|shoot_notes|SECRET|Private Rebook/);
  assert.deepEqual(f.saved,[]);
});

test('ordinary portal booking forwards selections, never private data or an old time',async()=>{
  const f=fixture();await assert.rejects(()=>f.page({searchParams:Promise.resolve({services:'video_tour',address:'private',shoot_notes:'SECRET',slot:'old',org:'other'})}),error=>error.url==='/book/property?org=company&services=video_tour');
  assert.deepEqual(f.saved,[]);
});
