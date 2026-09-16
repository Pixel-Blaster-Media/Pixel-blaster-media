// Exact Next production worker bytes in Chromium. Test-only generated network and
// virtual disk: proves maximum hashing/consumer behavior, NOT OPFS/iPhone export.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
const exec=promisify(execFile),out=process.env.PF_EVIDENCE_DIR;
assert.ok(out,'PF_EVIDENCE_DIR required');await mkdir(out,{recursive:true});
const dir='.next/static/chunks',names=await readdir(dir),sources=new Map();
for(const name of names.filter(n=>n.endsWith('.js')))sources.set(name,await readFile(`${dir}/${name}`,'utf8'));
const workerNames=[...sources].filter(([,s])=>s.includes('package_integrity')).map(([n])=>n);
assert.equal(workerNames.length,1,'exactly one compiled transfer chunk');
const workerName=workerNames[0];
const runtimes=[...sources].filter(([n,s])=>n.startsWith('turbopack-')&&!n.startsWith('turbopack-worker-')&&s.includes(workerName)).map(([n])=>n);
assert.equal(runtimes.length,1);
const parents=[...sources.values()].filter(s=>s.includes(workerName)&&s.includes('turbopack-worker-'));
assert.ok(parents.length);const bootstrap=parents[0].match(/static\/chunks\/(turbopack-worker-[^"']+\.js)/)?.[1];assert.ok(bootstrap);
const size=1100000000,chunkSize=131072,chunk=new Uint8Array(chunkSize).fill(0x61),hash=createHash('sha256'),chunkDigests=[];
for(let offset=0;offset<size;offset+=chunkSize){const b=chunk.subarray(0,Math.min(chunkSize,size-offset));hash.update(b);chunkDigests.push(createHash('sha256').update(b).digest('hex'));}
const metadata={transferId:'00000000-0000-4000-8000-000000000001',packageId:'00000000-0000-4000-8000-000000000002',packageSha256:hash.digest('hex'),indexSha256:'a'.repeat(64),byteSize:size,chunkSize,chunkCount:chunkDigests.length,chunkDigests};
const shim=`// TEST ONLY platform doubles; following bootstrap/imported chunks are unchanged.
const fixture=${JSON.stringify(metadata)};let size=0,written=0,requests=0;const truncations=[];
const payload=new Uint8Array(fixture.chunkSize).fill(0x61);
const disk={getSize:()=>size,read(){throw Error('unexpected_read');},write(b,{at}){if(at!==size)throw Error('noncontiguous_write');for(const x of b)if(x!==0x61)throw Error('wrong_byte');size+=b.length;written+=b.length;return b.length;},truncate(n){size=n;truncations.push(n);},flush(){},close(){}};
navigator.storage.getDirectory=async()=>({async *keys(){yield 'pixel-resume-epoch-test';},async getFileHandle(){return {createSyncAccessHandle:async()=>disk};}});
self.fetch=async url=>{const i=Number(new URL(url,location.origin).searchParams.get('index')),start=i*fixture.chunkSize,length=Math.min(fixture.chunkSize,fixture.byteSize-start);requests++;return new Response(payload.subarray(0,length),{status:206,headers:{'Content-Length':String(length),'Content-Range':'bytes '+start+'-'+(start+length-1)+'/'+fixture.byteSize,ETag:'"'+fixture.packageSha256+'"','X-Chunk-Sha256':fixture.chunkDigests[i]}});};
const send=self.postMessage.bind(self);self.postMessage=value=>send(value.state==='ready'?{...value,testOnlyDisk:{size,written,requests,truncations}}:value);
`;
const served=new Map();
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Maximum compiled-worker hash gate</title>');return;}
 const name=path.split('/').at(-1),source=sources.get(name);
 if(!path.startsWith('/_next/static/chunks/')||!source){res.writeHead(404);res.end();return;}
 served.set(name,createHash('sha256').update(source).digest('hex'));
 res.setHeader('Content-Type','text/javascript');res.end((name===bootstrap?shim:'')+source);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;let timer;let sampling=false;const samples=[];
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const cdp=await browser.newBrowserCDPSession();
 const sample=async()=>{if(sampling)return;sampling=true;try{const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');const ids=processInfo.map(p=>p.id);const {stdout}=await exec('ps',['-o','rss=','-p',ids.join(',')]);samples.push({elapsedMs:Date.now()-start,totalBrowserRssBytes:stdout.trim().split(/\s+/).reduce((s,n)=>s+Number(n)*1024,0)});}finally{sampling=false;}};
 const start=Date.now();await sample();timer=setInterval(()=>sample().catch(e=>console.error('RSS sample failed:',e.message)),250);
 const params=[['/_next/static/chunks/'+workerName,'/_next/static/chunks/'+runtimes[0]],'','/_next/','',''];
 await page.evaluate(({metadata,url})=>{window.done=null;window.w=new Worker(url);w.onerror=e=>{window.done={state:'script-error',message:e.message};};w.onmessage=({data})=>{if(['ready','error','unsupported','quota','paused','busy'].includes(data.state))window.done=data;};w.postMessage({op:'start',metadata,endpoint:'/resume',epoch:'pixel-resume-epoch-test'});},{metadata,url:'/_next/static/chunks/'+bootstrap+'?params='+encodeURIComponent(JSON.stringify(params))});
 await page.waitForFunction(()=>window.done!==null,{}, {timeout:180000});
 const result=await page.evaluate(()=>window.done);await sample();
 assert.equal(result.state,'ready',JSON.stringify(result));assert.equal(result.bytes,size);assert.equal(result.sha256,metadata.packageSha256);assert.equal(result.resumedAt,0);
 assert.deepEqual(result.testOnlyDisk,{size,written:size,requests:metadata.chunkCount,truncations:[0]});
 const baseline=samples[0].totalBrowserRssBytes,peak=Math.max(...samples.map(s=>s.totalBrowserRssBytes));
 assert.ok(peak-baseline<256*1024*1024,'browser RSS growth must not approach the package size');
 assert.ok(served.has(workerName)&&served.has(runtimes[0])&&served.has(bootstrap));
 const evidence={tier:'actual Next production worker/chunks, Chromium; generated bounded responses and TEST-ONLY virtual disk; NOT maximum OPFS/ZIP/iPhone export',result,elapsedMs:Date.now()-start,baselineBrowserRssBytes:baseline,peakBrowserRssBytes:peak,samples,servedChunks:Object.fromEntries(served),userAgent:await page.evaluate(()=>navigator.userAgent)};
 await writeFile(out+'/built-max-hash.json',JSON.stringify(evidence,null,2));
 await writeFile(out+'/built-max-worker.js',sources.get(workerName));
 console.log(JSON.stringify({...evidence,samples:samples.length}));
}finally{clearInterval(timer);await browser?.close();await new Promise(r=>server.close(r));}
