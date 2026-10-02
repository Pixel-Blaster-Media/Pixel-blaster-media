import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './helpers/source-module.mjs';
import { configuredCanonicalOrigin, publicRedirectOrigin } from '../lib/security/canonical-app-origin.ts';
import { isSameOriginRequest } from '../lib/security/request-origin.ts';

const origin='https://booking.example.invalid';
class NextResponse extends Response {
  static redirect(url,status) { return new NextResponse(null,{status,headers:{location:String(url)}}); }
}
function fixture(result={href:'/book/property?org=studio&draft=opaque'}) {
  const calls=[];
  const route=loadSource('app/book/rebook/route.ts',{
    'next/server':{NextResponse},
    '@/lib/booking/rebook':{startSimilarBooking:async form=>{calls.push(Object.fromEntries(form));return result;}},
    '@/lib/security/canonical-app-origin':{configuredCanonicalOrigin,publicRedirectOrigin},
    '@/lib/security/production-proxy-attestation':{verifyProductionProxyRequest:async()=>false},
    '@/lib/security/request-origin':{isSameOriginRequest},
  },{FormData});
  const request=(body='property_id=property&booking_id=booking',headers={})=>new Request(`${origin}/book/rebook`,{method:'POST',body,headers:{origin,host:new URL(origin).host,'content-type':'application/x-www-form-urlencoded',...headers}});
  return {route,request,calls};
}
test('rebook handoff accepts only a same-origin bounded form and redirects with GET semantics',async()=>{
  const f=fixture();const response=await f.route.POST(f.request());
  assert.equal(response.status,303);
  assert.equal(response.headers.get('location'),`${origin}/book/property?org=studio&draft=opaque`);
  assert.deepEqual(f.calls,[{property_id:'property',booking_id:'booking'}]);
  assert.equal(f.route.GET,undefined,'GET cannot write a private draft');
});
for(const [name,body,headers,status] of [
  ['cross origin','property_id=property',{origin:'https://attacker.invalid'},403],
  ['missing origin','property_id=property',{origin:''},403],
  ['opaque origin','property_id=property',{origin:'null'},403],
  ['wrong media','{}',{'content-type':'application/json'},415],
  ['duplicate ID','property_id=one&property_id=two',{},400],
  ['private field','property_id=one&shoot_notes=SECRET',{},400],
  ['oversized','property_id='+ 'x'.repeat(1024),{},413],
]) test(`rebook route rejects ${name} before auth/draft mutation`,async()=>{
  const f=fixture();assert.equal((await f.route.POST(f.request(body,headers))).status,status);assert.deepEqual(f.calls,[]);
});
test('failed draft storage returns a safe recoverable portal link',async()=>{
  const f=fixture({error:'private implementation detail'});const response=await f.route.POST(f.request());
  assert.equal(response.status,303);
  const url=new URL(response.headers.get('location'));
  assert.equal(url.pathname,'/portal/book');assert.equal(url.searchParams.get('rebook_error'),'draft_unavailable');
  assert.doesNotMatch(url.href,/implementation|private/);
});
test('authentication redirects from the POST use 303 rather than forwarding its body',async()=>{
  const f=fixture({href:'/auth/sign-in?audience=realtor'});const response=await f.route.POST(f.request());
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),`${origin}/auth/sign-in?audience=realtor`);
});
