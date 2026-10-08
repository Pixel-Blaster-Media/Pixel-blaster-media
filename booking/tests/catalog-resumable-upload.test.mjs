import assert from 'node:assert/strict';
import test from 'node:test';
import { tsImport } from 'tsx/esm/api';
import { Upload } from 'tus-js-client';
import {readFileSync} from 'node:fs';
const policy=(await tsImport('../lib/booking/catalog-upload-policy.ts',import.meta.url)).default;
const core=(await tsImport('../lib/booking/catalog-examples-core.ts',import.meta.url)).default;
const transport=(await tsImport('../lib/booking/catalog-upload-transport.ts',import.meta.url)).default;
const env={CLOUDFLARE_STREAM_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_STREAM_API_TOKEN:'mock-only-token',NEXT_PUBLIC_APP_URL:'https://pixelblastermedia.com'};
const claim='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',uid='b'.repeat(32);

test('exact decimal 1GB boundary and safe upload capabilities',()=>{
 for(const size of [1,300_000_000,500_000_000,1_000_000_000])assert.equal(policy.validCatalogUploadSize(size),true);
 for(const size of [0,-1,1.5,1_000_000_001,NaN,Infinity,'500000000',null])assert.equal(policy.validCatalogUploadSize(size),false);
 for(const url of ['http://upload.videodelivery.net/a','https://evil.test/a','https://upload.videodelivery.net.evil.test/a','https://user:password@upload.videodelivery.net/a','https://upload.videodelivery.net:444/a'])assert.equal(policy.validStreamUploadCapability(url),false);
 assert.equal(policy.validStreamUploadCapability('https://upload.videodelivery.net/private-capability'),true);
});

test('reselected file fingerprint is stable and changes with file identity/content',async()=>{
 const file=(bytes,name='sample.mp4')=>new File([bytes],name,{type:'video/mp4',lastModified:1});
 const a=await policy.catalogFileFingerprint(file('abc'));
 assert.match(a,/^[a-f0-9]{64}$/);assert.equal(await policy.catalogFileFingerprint(file('abc')),a);
 assert.notEqual(await policy.catalogFileFingerprint(file('abd')),a);
 assert.notEqual(await policy.catalogFileFingerprint(file('abc','other.mp4')),a);
});

test('tus provisioning pins length/duration/origin, verifies provider restrictions, and never parses UID from URL',async()=>{
 const calls=[];const expiresAt=new Date(Date.now()+3600_000).toISOString();
 const result=await core.createStreamTusUpload({name:'4K sample',operationId:claim,size:500_000_000,expiresAt,env,
  fetchImpl:async(url,init)=>{calls.push({url,init});return calls.length===1
   ?new Response(null,{status:201,headers:{Location:'https://upload.videodelivery.net/not-the-uid','stream-media-id':uid}})
   :Response.json({success:true,result:{uid,allowedOrigins:['pixelblastermedia.com'],maxDurationSeconds:600,uploadExpiry:expiresAt,creator:claim,meta:{catalogUploadClaimId:claim}}});}});
 assert.deepEqual(result,{uid,uploadUrl:'https://upload.videodelivery.net/not-the-uid'});
 assert.match(calls[0].url,/stream\?direct_user=true$/);
 assert.equal(calls[0].init.headers['Upload-Length'],'500000000');
 assert.equal(calls[0].init.headers['Tus-Resumable'],'1.0.0');
 const meta=Object.fromEntries(calls[0].init.headers['Upload-Metadata'].split(',').map(p=>{const [k,v]=p.split(' ');return [k,Buffer.from(v,'base64').toString()]}));
 assert.equal(meta.maxDurationSeconds,'600');assert.equal(meta.expiry,expiresAt);
 assert.equal(meta.allowedorigins,'pixelblastermedia.com');assert.equal(meta.catalogUploadClaimId,claim);
 assert.equal(calls[0].init.headers['Upload-Creator'],claim);
 assert.equal(calls[1].url.endsWith('/'+uid),true);
});

test('tus origin metadata round-trips as a domain list, without JSON punctuation',async()=>{
 const expiresAt=new Date(Date.now()+3600_000).toISOString();
 let retainedOrigins,originEntry;const methods=[];
 const result=await core.createStreamTusUpload({name:"One'er",operationId:claim,size:227010474,expiresAt,env,
  fetchImpl:async(url,init)=>{
   methods.push(init.method??'GET');
   if(init.method==='POST'){
    assert.equal(init.body,undefined);assert.equal(init.headers['Upload-Length'],'227010474');
    originEntry=init.headers['Upload-Metadata'].split(',').find(value=>value.startsWith('allowedorigins '));
    // A single-domain list has the exact UTF-8/base64 bytes below. The provider list
    // decoder must not need JSON.parse: JSON brackets/quotes become part of a domain.
    retainedOrigins=Buffer.from(originEntry.slice('allowedorigins '.length),'base64').toString('utf8').split(',');
    return new Response(null,{status:201,headers:{Location:'https://upload.videodelivery.net/mock-capability','stream-media-id':uid}});
   }
   assert.equal(url.endsWith('/'+uid),true);
   return Response.json({success:true,result:{uid,allowedOrigins:retainedOrigins,maxDurationSeconds:600,
    uploadExpiry:expiresAt,creator:claim,meta:{catalogUploadClaimId:claim}}});
  }});
 assert.equal(originEntry,'allowedorigins cGl4ZWxibGFzdGVybWVkaWEuY29t');
 assert.deepEqual(retainedOrigins,['pixelblastermedia.com']);
 assert.deepEqual(methods,['POST','GET']);assert.equal(result.uid,uid);
});

test('origin encoding repair still rejects missing, malformed, widened and different retained restrictions',async()=>{
 const expiresAt=new Date(Date.now()+3600_000).toISOString();
 const rejected=[undefined,null,[],['*'],['*.pixelblastermedia.com'],['www.pixelblastermedia.com'],
  ['https://pixelblastermedia.com'],['pixelblastermedia.com.attacker.test'],
  ['pixelblastermedia.com','attacker.test'],['pixelblastermedia.com','pixelblastermedia.com'],
  ['["pixelblastermedia.com"]'],'pixelblastermedia.com'];
 for(const allowedOrigins of rejected){
  let calls=0;
  await assert.rejects(core.createStreamTusUpload({name:'Sample',operationId:claim,size:227010474,expiresAt,env,
   fetchImpl:async()=>++calls===1
    ?new Response(null,{status:201,headers:{Location:'https://upload.videodelivery.net/never-expose-capability','stream-media-id':uid}})
    :Response.json({success:true,result:{uid,allowedOrigins,maxDurationSeconds:600,uploadExpiry:expiresAt,
      creator:claim,meta:{catalogUploadClaimId:claim}}})}),error=>{
    assert.equal(error.outcome,'ambiguous');assert.equal(error.streamUid,uid);
    assert.equal(error.diagnostic.stage,'restriction_verification');
    assert.equal(error.diagnostic.checks.allowedOrigin,false);
    assert.equal(Object.values(error.diagnostic.checks).filter(value=>!value).length,1);
    assert.doesNotMatch(JSON.stringify(error),/never-expose-capability|mock-only-token|attacker/);
    return true;
   });
  assert.equal(calls,2);
 }
});

test('provider ambiguity/restriction mismatch withholds capability and preserves known UID for cleanup',async()=>{
 let n=0;
 await assert.rejects(core.createStreamTusUpload({name:'Sample',operationId:claim,size:1_000_000_000,
 expiresAt:new Date(Date.now()+3600_000).toISOString(),env,fetchImpl:async()=>++n===1
 ?new Response(null,{status:201,headers:{Location:'https://upload.videodelivery.net/cap','stream-media-id':uid}})
 :Response.json({success:true,result:{uid,allowedOrigins:[],creator:claim,meta:{catalogUploadClaimId:claim}}})}),e=>e.outcome==='ambiguous'&&e.streamUid===uid);
 assert.equal(n,2);
 await assert.rejects(core.createStreamTusUpload({name:'Sample',operationId:claim,size:1_000_000_001,
 expiresAt:new Date(Date.now()+3600_000).toISOString(),env,fetchImpl:()=>{throw new Error('Must not call provider')}}),/Invalid resumable/);
});

test('capability rejection reports boolean reasons without a follow-up request or any capability value',async()=>{
 const cases=[
  {location:null,key:'capabilityPresent'},
  {location:'',key:'capabilityPresent'},
  {location:'not-a-url',key:'capabilityParseable'},
  {location:'https://upload.videodelivery.net/'+ 'x'.repeat(4096),key:'capabilityWithinLength'},
  {location:'http://upload.videodelivery.net/secret-cap',key:'capabilityHttps'},
  {location:'https://private.invalid/secret-cap',key:'capabilityAllowedHost'},
  {location:'https://upload.videodelivery.net.private.invalid/secret-cap',key:'capabilityAllowedHost'},
  {location:'https://user:secret-password@upload.videodelivery.net/secret-cap',key:'capabilityNoCredentials'},
  {location:'https://upload.videodelivery.net:444/secret-cap',key:'capabilityDefaultPort'},
  {location:'https://upload.videodelivery.net/secret-cap#secret-fragment',key:'capabilityNoFragment'},
  {location:'https://upload.videodelivery.net/',key:'capabilityPath'},
  {location:'https://upload.videodelivery.net/secret-cap',videoId:null,key:'uidPresent'},
  {location:'https://upload.videodelivery.net/secret-cap',videoId:'bad-secret-id',key:'uidValid'},
 ];
 for(const {location,videoId=uid,key} of cases){
  let calls=0;const headers=new Headers();if(location!==null)headers.set('Location',location);if(videoId!==null)headers.set('stream-media-id',videoId);
  await assert.rejects(core.createStreamTusUpload({name:'Sample',operationId:claim,size:227010474,
   expiresAt:new Date(Date.now()+3600_000).toISOString(),env,fetchImpl:async()=>{calls++;return new Response('secret-provider-body',{status:201,headers})}}),error=>{
    assert.equal(error.outcome,'ambiguous');assert.equal(error.streamUid,videoId===uid?uid:undefined);
    assert.equal(error.diagnostic.stage,'capability_validation');assert.equal(error.diagnostic.httpStatus,201);
    assert.equal(error.diagnostic.verified,false);assert.equal(error.diagnostic.checks[key],false);
    assert.ok(Object.values(error.diagnostic.checks).every(value=>typeof value==='boolean'));
    assert.doesNotMatch(JSON.stringify(error.diagnostic),/secret-|private\.invalid|mock-only-token|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
    return true;
   });assert.equal(calls,1);
 }
});

test('capability diagnostics preserve the existing acceptance predicate, including URL normalization',()=>{
 const prior=value=>{if(typeof value!=='string'||value.length>4096)return false;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&(u.hostname==='upload.videodelivery.net'||/^[a-z0-9-]+\.cloudflarestream\.com$/.test(u.hostname))&&u.pathname.length>1;}catch{return false}};
 const hosts=['upload.videodelivery.net','customer-abc.cloudflarestream.com','cloudflarestream.com','a.b.cloudflarestream.com','bad.example','UPLOAD.VIDEODELIVERY.NET'];
 const values=[undefined,null,0,{},'', 'not-a-url', 'x'.repeat(4097)];
 for(const host of hosts)for(const scheme of ['http:','https:'])for(const suffix of ['/','/cap','/cap?secret=query','/cap#fragment']){
  values.push(`${scheme}//${host}${suffix}`,`${scheme}//user:pass@${host}${suffix}`,`${scheme}//${host}:443${suffix}`,`${scheme}//${host}:444${suffix}`);
 }
 for(const value of values)assert.equal(policy.validStreamUploadCapability(value),prior(value));
});

test('provider creation status and transport failures are distinguished without reading or logging response bodies',async()=>{
 for(const status of [400,408,429,500,200]){
  let calls=0;await assert.rejects(core.createStreamTusUpload({name:'Sample',operationId:claim,size:227010474,
   expiresAt:new Date(Date.now()+3600_000).toISOString(),env,fetchImpl:async()=>{calls++;return new Response('private-secret-response',{status})}}),error=>{
   assert.deepEqual(error.diagnostic,{verified:false,stage:'provider_create',httpStatus:status,checks:null});
   assert.equal(error.outcome,status===400?'definitive':'ambiguous');assert.equal(error.streamUid,undefined);return true;
  });assert.equal(calls,1);
 }
 await assert.rejects(core.createStreamTusUpload({name:'Sample',operationId:claim,size:227010474,
  expiresAt:new Date(Date.now()+3600_000).toISOString(),env,fetchImpl:async()=>{throw new Error('private-secret-transport')}}),error=>{
  assert.deepEqual(error.diagnostic,{verified:false,stage:'provider_create',httpStatus:null,checks:null});
  assert.doesNotMatch(JSON.stringify(error),/private-secret-transport/);return true;
 });
});

test('expiry diagnostics distinguish missing, invalid and subsecond mismatch while requiring the exact timestamp',async()=>{
 const expiresAt=new Date(Math.floor((Date.now()+3600_000)/1000)*1000+123).toISOString();
 const baseline={uid,allowedOrigins:['pixelblastermedia.com'],maxDurationSeconds:600,
  creator:claim,meta:{catalogUploadClaimId:claim}};
 const epoch=Date.parse(expiresAt);
 for(const [uploadExpiry,expected] of [
  [undefined,{present:false,parseable:false,exactMatch:false,sameWholeSecond:false}],
  ['secret-invalid-expiry',{present:true,parseable:false,exactMatch:false,sameWholeSecond:false}],
  [new Date(epoch+1).toISOString(),{present:true,parseable:true,exactMatch:false,sameWholeSecond:true}],
  [new Date(epoch+1000).toISOString(),{present:true,parseable:true,exactMatch:false,sameWholeSecond:false}],
  [expiresAt,{present:true,parseable:true,exactMatch:true,sameWholeSecond:true}],
  [expiresAt.replace('Z','+00:00'),{present:true,parseable:true,exactMatch:true,sameWholeSecond:true}],
 ]){
  const fetchImpl=async()=>Response.json({success:true,result:{...baseline,uploadExpiry}});
  const inspection=await core.inspectStreamTusReservation({uid,operationId:claim,expiresAt,env,fetchImpl});
  assert.deepEqual(inspection.expiryChecks,expected);assert.equal(inspection.checks.expiry,expected.exactMatch);
  assert.equal(inspection.verified,expected.exactMatch);
  assert.doesNotMatch(JSON.stringify(inspection),/secret-invalid-expiry|uploadExpiry|expiresAt|T\d\d:/);
  if(!expected.exactMatch){let calls=0;await assert.rejects(core.createStreamTusUpload({name:'Sample',operationId:claim,size:227010474,expiresAt,env,
   fetchImpl:async()=>++calls===1?new Response(null,{status:201,headers:{Location:'https://upload.videodelivery.net/private-cap','stream-media-id':uid}}):fetchImpl()}),error=>{
    assert.deepEqual(error.diagnostic.expiryChecks,expected);assert.equal(error.streamUid,uid);return true;
   });assert.equal(calls,2);}
 }
});

test('duration, expiry and claim identity must survive provider readback before exposing a capability',async()=>{
 const expiresAt=new Date(Date.now()+3600_000).toISOString();
 for(const changed of [{maxDurationSeconds:601},{maxDurationSeconds:undefined},{uploadExpiry:undefined},
  {uploadExpiry:new Date(Date.now()+7200_000).toISOString()},{creator:'another-claim'},
  {meta:{catalogUploadClaimId:'another-claim'}}]){
  let n=0;await assert.rejects(core.createStreamTusUpload({name:'Sample',operationId:claim,size:500_000_000,expiresAt,env,
   fetchImpl:async()=>++n===1?new Response(null,{status:201,headers:{Location:'https://upload.videodelivery.net/mock','stream-media-id':uid}})
    :Response.json({success:true,result:{uid,allowedOrigins:['pixelblastermedia.com'],creator:claim,maxDurationSeconds:600,uploadExpiry:expiresAt,meta:{catalogUploadClaimId:claim},...changed}})
  }),error=>error.streamUid===uid&&error.outcome==='ambiguous');assert.equal(n,2);
 }
});

// The SDK reads real bounded chunk bodies generated on demand. No 1GB buffer,
// network listener, provider upload, token or billable storage is used.
function logicalFile(size){
 const file=new Blob([],{type:'video/mp4'});
 Object.defineProperty(file,'size',{value:size});
 file.slice=(start,end)=>new Blob([new Uint8Array(Math.min(size,end)-start)]);
 return file;
}
async function transfer(size,{lostResponse=false,resumeAt=0}={}){
 let offset=resumeAt,accepted=0,retried=false;const calls=[];
 const stack={getName:()=> 'mock-only',createRequest(method,url){
  const headers={};let progress;return {getMethod:()=>method,getURL:()=>url,setHeader:(k,v)=>{headers[k]=v},getHeader:k=>headers[k],
   setProgressHandler:fn=>{progress=fn},getUnderlyingObject:()=>({}),abort:async()=>{},
   send:async body=>{
    assert.equal(url,'https://upload.videodelivery.net/mock');assert.equal(headers.Authorization,undefined);
    calls.push({method,offset,bodyBytes:body?.size??0});
    const response=(status,values={})=>({getStatus:()=>status,getHeader:k=>values[k.toLowerCase()]??null,getBody:()=>'',getUnderlyingObject:()=>({})});
    if(method==='HEAD')return response(200,{'upload-offset':String(offset),'upload-length':String(size)});
    assert.equal(method,'PATCH');assert.equal(Number(headers['Upload-Offset']),offset);
    assert.ok(body.size<=policy.CATALOG_UPLOAD_CHUNK_BYTES);assert.equal(headers['Content-Type'],'application/offset+octet-stream');
    assert.equal((await body.arrayBuffer()).byteLength,body.size);
    offset+=body.size;accepted+=body.size;progress?.(body.size);
    if(lostResponse&&!retried){retried=true;throw new Error('Mock response lost after provider accepted chunk');}
    return response(204,{'upload-offset':String(offset)});
   }};
 }};
 await new Promise((resolve,reject)=>{
  const upload=new Upload(logicalFile(size),{uploadUrl:'https://upload.videodelivery.net/mock',uploadSize:size,
   chunkSize:policy.CATALOG_UPLOAD_CHUNK_BYTES,httpStack:stack,retryDelays:[0,1,1],storeFingerprintForResuming:false,
   fileReader:{openFile:async input=>({size:input.size,slice:async(start,end)=>({value:input.slice(start,end),done:end>=input.size}),close(){}})},
   onError:reject,onSuccess:resolve});upload.start();
 });
 assert.equal(offset,size);assert.equal(accepted,size-resumeAt);
 return calls;
}
for(const size of [300_000_000,500_000_000,1_000_000_000])test(`SDK completes ${size} logical bytes in real bounded chunks without a provider`,async()=>{
 const calls=await transfer(size);assert.equal(calls[0].method,'HEAD');assert.ok(calls.filter(c=>c.method==='PATCH').length>1);
});
test('lost response resumes from provider offset without resending accepted bytes',async()=>{
 const calls=await transfer(30_000_000,{lostResponse:true});assert.ok(calls.filter(c=>c.method==='HEAD').length>=2);
});
test('refresh/new SDK instance resumes from existing offset rather than zero',async()=>{
 const calls=await transfer(30_000_000,{resumeAt:policy.CATALOG_UPLOAD_CHUNK_BYTES});
 assert.equal(calls.find(c=>c.method==='PATCH').offset,policy.CATALOG_UPLOAD_CHUNK_BYTES);
});

test('actual pinned browser XHR stack rejects timeouts instead of leaving the SDK promise pending',async()=>{
 const source=readFileSync(new URL('../node_modules/tus-js-client/lib/browser/httpStack.js',import.meta.url),'utf8');
 const {default:Stack}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const original=globalThis.XMLHttpRequest;
 class MockXHR extends EventTarget {
  open(){} setRequestHeader(){} abort(){}
  dispatchEvent(event){const result=super.dispatchEvent(event);this['on'+event.type]?.(event);return result}
  send(){queueMicrotask(()=>this.dispatchEvent(new Event('timeout')))}
 }
 globalThis.XMLHttpRequest=MockXHR;
 try {
  const request=new Stack().createRequest('HEAD','https://upload.videodelivery.net/mock');
  transport.configureCatalogUploadRequest(request.getUnderlyingObject());
  assert.equal(request.getUnderlyingObject().timeout,300_000);
  await assert.rejects(request.send(),error=>error.type==='error');
 }finally{globalThis.XMLHttpRequest=original}
});


test('existing reservation inspection is GET-only, identifies every mismatch, and never returns raw provider values',async()=>{
 const expiresAt=new Date(Date.now()+3600_000).toISOString();
 const baseline={uid,allowedOrigins:['pixelblastermedia.com'],maxDurationSeconds:600,
  uploadExpiry:expiresAt,creator:claim,meta:{catalogUploadClaimId:claim}};
 for(const [key,change] of [['uid',{uid:'wrong'}],['allowedOrigin',{allowedOrigins:['wrong.test']}],
  ['maxDuration',{maxDurationSeconds:601}],['expiry',{uploadExpiry:'invalid'}],
  ['creator',{creator:'wrong'}],['claimMetadata',{meta:{catalogUploadClaimId:'wrong'}}]]){
  const calls=[];
  const result=await core.inspectStreamTusReservation({uid,operationId:claim,expiresAt,env,
   fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json({success:true,result:{...baseline,...change,secret:'never-expose',uploadURL:'https://private.invalid/cap'}})}});
  assert.equal(result.verified,false);assert.equal(result.stage,'restriction_verification');
  assert.equal(result.checks[key],false);assert.equal(Object.values(result.checks).filter(x=>!x).length,1);
  assert.equal(calls.length,1);assert.equal(calls[0].init.method,undefined);
  assert.equal(calls[0].url.endsWith('/'+uid),true);
  const publicResult=JSON.stringify(result);assert.doesNotMatch(publicResult,/never-expose|private.invalid|mock-only-token|wrong.test/);
 }
 const matched=await core.inspectStreamTusReservation({uid,operationId:claim,expiresAt,env,
  fetchImpl:async()=>Response.json({success:true,result:baseline})});assert.equal(matched.verified,true);
 for(const fetchImpl of [async()=>new Response(null,{status:404}),async()=>{throw new Error('secret provider exception')},async()=>Response.json(null)]){
  const result=await core.inspectStreamTusReservation({uid,operationId:claim,expiresAt,env,fetchImpl});
  assert.equal(result.verified,false);assert.doesNotMatch(JSON.stringify(result),/secret provider exception/);
 }
});
