#!/usr/bin/env node
// Local by default. No dotenv loading, session provisioning, retry or reset.
import {constants} from 'node:fs';
import {open, lstat, realpath} from 'node:fs/promises';
import {dirname, resolve, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';

function check(ok) {if(!ok)throw new Error('operator_smoke_driver_refused');}
async function journalFile(path) {
  check(typeof path==='string' && isAbsolute(path));
  const parent=dirname(path), info=await lstat(parent);
  check(info.isDirectory() && (info.mode&0o777)===0o700 && info.uid===process.getuid() && await realpath(parent)===resolve(parent));
  return open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
}
async function protectedText(path) {
  check(typeof path==='string' && isAbsolute(path));
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await file.stat();check(info.isFile() && info.uid===process.getuid() && (info.mode&0o777)===0o600 && info.size>0 && info.size<=8192);
    const buffer=Buffer.alloc(8193), {bytesRead}=await file.read(buffer,0,buffer.length,0);check(bytesRead===info.size);
    return buffer.subarray(0,bytesRead).toString('utf8');
  }finally{await file.close();}
}
export async function prepareHostedSmoke({authorizationFile,cookieFile}) {
  const ticket=JSON.parse(await protectedText(authorizationFile)), a=ticket.admission;
  check(ticket.authorization==='separately-authorized-one-shot-hosted-smoke-v1' && Object.keys(ticket).length===2 && a);
  const keys=['version','issuedAt','expiresAt','runId','actorId','organizationId','origin','claimKey','objectKey','resourceSha256'];
  check(Object.keys(a).length===keys.length && keys.every(k=>typeof a[k]==='string' && a[k].length<=512));
  check(a.version==='non-certifying-storage-smoke-v1' && a.origin==='https://pixelblastermedia.com');
  const now=Date.now(),issued=Date.parse(a.issuedAt),expires=Date.parse(a.expiresAt);
  check(issued<=now && now<expires && expires-issued<=600000);
  check([a.runId,a.actorId,a.organizationId].every(v=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v)) && /^[a-f0-9]{64}$/.test(a.resourceSha256));
  const prefix=`operator-smoke/v1/${a.organizationId}/${a.runId}`;
  check(a.claimKey===prefix+'/claim.json' && a.objectKey===prefix+'/payload.bin');
  const cookie=await protectedText(cookieFile);check(cookie.length<=8192 && /^[\x20-\x7e]+$/.test(cookie) && cookie.includes('='));
  return {origin:a.origin,registration:a,cookie};
}
function responseOnce(origin, headers) {
  return new Promise((yes,no)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    const fail=()=>{clearTimeout(timer);no(new Error('operator_smoke_stop_unconfirmed'));};
    const req=(origin.startsWith('https:')?httpsRequest:httpRequest)(new URL('/api/photo-finals/operator-smoke',origin),{method:'POST',headers:{...headers,origin,'content-length':'0','accept-encoding':'identity'},agent:false,maxHeaderSize:8192,signal:controller.signal},res=>{
      void (async()=>{try {
        check([200,400,403,404,409,503].includes(res.statusCode));
        check(/^application\/json(?:;|$)/.test(res.headers['content-type']??''));
        check(!res.headers['content-encoding']||res.headers['content-encoding']==='identity');
        const length=res.headers['content-length'];check(length===undefined||/^(0|[1-9][0-9]*)$/.test(length)&&Number(length)<=2048);
        const chunks=[];let bytes=0;for await(const chunk of res){bytes+=chunk.length;check(bytes<=2048);chunks.push(chunk);}
        check(length===undefined||bytes===Number(length));
        const dto=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const statuses={200:'verified-storage-smoke',400:'invalid-request',403:'denied',404:'disabled',409:'stop-consumed'};
        check(dto && typeof dto==='object' && !Array.isArray(dto));
        check(res.statusCode===503?['stop','not-admitted'].includes(dto.status):dto.status===statuses[res.statusCode]);
        const result={status:dto.status};
        if(res.statusCode===200){
          check(dto.certified===false&&dto.payloadBytes===65536&&dto.rangeBytes===1024&&dto.operations===5&&Number.isInteger(dto.uploadBytes)&&dto.uploadBytes>131072&&dto.uploadBytes<=132096);
          Object.assign(result,{certified:false,payloadBytes:65536,rangeBytes:1024,operations:5,uploadBytes:dto.uploadBytes});
        }
        clearTimeout(timer);yes(result);
      }catch{res.destroy();req.destroy();fail();}})();
    });req.on('error',fail);req.end();
  });
}
export async function runOperatorSmoke({origin='http://127.0.0.1:3000',journal,mode='local',authorizationFile,cookieFile}) {
  check(mode==='local'||mode==='hosted');
  const hosted=mode==='hosted'?await prepareHostedSmoke({authorizationFile,cookieFile}):null;
  if(hosted)origin=hosted.origin;
  const url=new URL(origin);
  if(!hosted)check(url.origin===origin && url.protocol==='http:' && url.hostname==='127.0.0.1' && url.port && !url.username && !url.password);
  const file=await journalFile(journal);
  const append=async row=>{await file.write(JSON.stringify(row)+'\n');await file.sync();};
  try {
    await append({state:'attempt-sealed',mode,origin,at:new Date().toISOString(),retry:false,...(hosted?{registration:hosted.registration}:{})});
    // Durably retain the new directory entry before any network side effect.
    const directory=await open(dirname(journal),constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
    try {
      if(hosted)check(Date.now()<Date.parse(hosted.registration.expiresAt));
      const result=await responseOnce(origin,hosted?{cookie:hosted.cookie}:{});
      await append({state:'finished-no-retry',result});return result;
    }catch{await append({state:'STOP-unconfirmed-no-retry'});throw new Error('operator_smoke_stop_unconfirmed');}
  }finally{await file.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try {
    const args=process.argv.slice(2);
    const hosted=args[0]==='--hosted';
    if(hosted)check(args.length===7 && args[1]==='--authorization-file' && args[3]==='--cookie-file' && args[5]==='--journal');
    else {check(args.length===2||args.length===4);check(args[0]==='--journal');check(args.length===2||args[2]==='--local-origin');}
    const result=await runOperatorSmoke(hosted?{mode:'hosted',authorizationFile:args[2],cookieFile:args[4],journal:args[6]}:{journal:args[1],origin:args[3]});
    console.log(JSON.stringify(result));
    if(result.status!=='verified-storage-smoke' && (hosted||result.status!=='disabled'))process.exitCode=1;
  }catch{console.error('STOP: refused or unconfirmed; do not retry, replace the journal, or re-arm.');process.exitCode=1;}
}
