import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinalsHandler} from '../lib/media/finals/http.ts';
import {scope,identity,fixture} from './helpers/photo-finals-operator-fixture.mjs';
const request=(headers={})=>new Request('http://localhost/api/photo-finals/'+scope.bookingId,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',...headers},body:JSON.stringify({op:'work'})});
test('work returns accepted before due/claim and callback alone executes the existing attempt',async()=>{
 const f=fixture(),handler=createFinalsHandler(f.deps);
 const response=await handler(request(),scope.bookingId);
 assert.equal(response.status,202);assert.deepEqual(await response.json(),{status:'packaging'});
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(f.callbacks.length,1);assert.equal(f.calls.includes('photo_finals_package_due'),false);
 await f.callbacks[0]();assert.equal(f.calls.filter(n=>n==='photo_finals_package_due').length,1);
});
test('denials and callback registration failure never report accepted',async()=>{
 for(const mode of ['anonymous','operator','origin','identity','access','schedule','terminal']){
  const f=fixture();let headers={};
  if(mode==='anonymous')f.deps.authorize=async()=>null;
  if(mode==='operator')f.deps.authorize=async()=>({...identity,operator:false});
  if(mode==='origin')headers.origin='http://attacker.invalid';
  if(mode==='identity')headers['x-finals-identity']='stale';
  if(mode==='access')f.revoke();
  if(mode==='schedule')f.deps.schedule=()=>{throw Error('registration failed');};
  if(mode==='terminal')f.runtime.readPackageStatus=async()=>({status:'needs_attention'});
  const response=await createFinalsHandler(f.deps)(request(headers),scope.bookingId);
  assert.notEqual(response.status,202,mode);assert.equal(f.callbacks.length,0,mode);assert.equal(f.calls.includes('photo_finals_package_due'),false,mode);
 }
});
test('callback reauthorizes current SQL access before dispatch',async()=>{
 const f=fixture();assert.equal((await createFinalsHandler(f.deps)(request(),scope.bookingId)).status,202);
 f.revoke();await f.callbacks[0]();assert.equal(f.calls.includes('photo_finals_package_due'),false);
});

test('scope opt-in removed after admission leaves the approved job unclaimed',async()=>{
 const f=fixture();assert.equal((await createFinalsHandler(f.deps)(request(),scope.bookingId)).status,202);
 f.runtime.env.PHOTO_FINALS_ALLOWED_SCOPES='[]';await f.callbacks[0]();assert.equal(f.calls.includes('photo_finals_package_due'),false);
});
