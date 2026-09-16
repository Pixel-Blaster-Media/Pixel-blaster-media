import 'server-only';
import {createHash} from 'node:crypto';
import {S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand} from '@aws-sdk/client-s3';
import {request as httpsRequest} from 'node:https';
import type {HttpRequest, HttpHandlerOptions} from '@smithy/types';
import {Readable} from 'node:stream';

type Command = PutObjectCommand | HeadObjectCommand | GetObjectCommand;
type StorageResponse = {$metadata?:{httpStatusCode?:number}; ETag?:string; ContentLength?:number; ContentType?:string; ContentRange?:string; Metadata?:Record<string,string>; Body?:Readable};
type SmokeStorage = {send(command:Command, options:{abortSignal:AbortSignal}):Promise<StorageResponse>; destroy?:()=>void};

type Env = Readonly<Record<string, string | undefined>>;
export type SmokeIdentity = {actorId:string; organizationId:string; role:string; archivedAt:string|null; membershipRole:string};
type Dependencies = {env:Env; authorize:(request:Request, signal:AbortSignal)=>Promise<SmokeIdentity|null>; storage:(config:ReturnType<typeof loadSmokeAdmission>, env:Env)=>SmokeStorage};
const hash = (bytes:string|Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PATH = '/api/photo-finals/operator-smoke';
function requireValue(ok:unknown):asserts ok {if(!ok)throw new Error('smoke_refused');}
function record<K extends string>(raw:string|undefined, keys:K[]):Record<K,string> {
  requireValue(raw && Buffer.byteLength(raw)<=4096);
  const value:unknown=JSON.parse(raw);
  requireValue(value && typeof value==='object' && !Array.isArray(value));
  const r=value as Record<string,unknown>;
  requireValue(Object.keys(r).length===keys.length && keys.every(k=>typeof r[k]==='string' && (r[k] as string).length<=512));
  return r as Record<string,string>;
}
function timestamp(value:string) {const n=Date.parse(value);requireValue(Number.isFinite(n)&&new Date(n).toISOString()===value);return n;}
export function loadSmokeAdmission(env:Env, now=Date.now()) {
  const a=record(env.PHOTO_FINALS_SMOKE_ADMISSION,['version','issuedAt','expiresAt','runId','actorId','organizationId','origin','claimKey','objectKey','resourceSha256']);
  const r=record(env.PHOTO_FINALS_SMOKE_RESOURCE,['accountId','bucket','endpoint','privateAccess','retentionUntil','allowance']);
  requireValue(a.version==='non-certifying-storage-smoke-v1');
  const issued=timestamp(a.issuedAt), expires=timestamp(a.expiresAt), retention=timestamp(r.retentionUntil);
  requireValue(issued<=now && now<expires && expires-issued<=600000 && retention>expires && retention-issued<=30*86400000);
  requireValue([a.runId,a.actorId,a.organizationId].every(v=>UUID.test(v)));
  const origin=new URL(a.origin);
  requireValue(origin.protocol==='https:' && origin.origin===a.origin && !origin.username && !origin.password && !origin.port);
  const prefix=`operator-smoke/v1/${a.organizationId}/${a.runId}`;
  requireValue(a.claimKey===prefix+'/claim.json' && a.objectKey===prefix+'/payload.bin');
  requireValue(/^[a-f0-9]{32}$/.test(r.accountId) && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(r.bucket));
  requireValue(r.endpoint===`https://${r.accountId}.r2.cloudflarestorage.com`);
  requireValue(r.privateAccess==='verified-private-no-public-domains' && r.allowance==='one-run-3-class-a-2-class-b-132096-upload-bytes');
  requireValue(a.resourceSha256===hash(env.PHOTO_FINALS_SMOKE_RESOURCE!));
  requireValue(/^[a-f0-9]{32}$/.test(env.PHOTO_FINALS_SMOKE_R2_ACCESS_KEY_ID??'') && /^[a-f0-9]{64}$/.test(env.PHOTO_FINALS_SMOKE_R2_SECRET_ACCESS_KEY??''));
  return Object.freeze({...a,...r,expires});
}
/** Fixed signed transport: no redirects, retries, arbitrary endpoints or SDK error-body aggregation.
 * requestImpl is an in-process test seam; the route never accepts or selects it. */
export function createSmokeStorage(config:ReturnType<typeof loadSmokeAdmission>, env:Env, requestImpl:typeof httpsRequest=httpsRequest):SmokeStorage {
  let step=0;
  const methods=['PUT','PUT','PUT','HEAD','GET'];
  const keys=[config.claimKey,config.objectKey,config.objectKey,config.objectKey,config.objectKey];
  const handler={async handle(request:HttpRequest, options:HttpHandlerOptions={}) {
    const index=step++;
    const hostname=`${config.bucket}.${config.accountId}.r2.cloudflarestorage.com`;
    requireValue(index<5 && request.protocol==='https:' && request.hostname===hostname && (!request.port||request.port===443) && request.method===methods[index] && request.path==='/'+keys[index]);
    const operation=index<3?'PutObject':index===3?'HeadObject':'GetObject';
    requireValue(Object.entries(request.query??{}).every(([k,v])=>k==='x-id' && v===operation));
    requireValue(request.headers.host===hostname);
    if(index<3)requireValue(request.headers['if-none-match']==='*' && request.body instanceof Uint8Array && request.body.length===(index===0?Number(request.headers['content-length']):65536) && request.body.length>0 && request.body.length<=(index===0?1024:65536));
    if(index===4)requireValue(request.headers.range==='bytes=1024-2047' && request.headers['if-match']);
    const parent=options.abortSignal;
    requireValue(parent instanceof AbortSignal && !parent.aborted);
    return new Promise<{response:{statusCode:number;headers:Record<string,string>;body:Readable}}>((resolve,reject)=>{
      const controller=new AbortController();
      const stop=()=>controller.abort();
      parent.addEventListener('abort',stop,{once:true});
      // One transport deadline includes DNS, TLS, headers and body, not per-chunk idle time.
      const timer=setTimeout(stop,5000);
      const finish=()=>{clearTimeout(timer);parent.removeEventListener('abort',stop);};
      const fail=()=>{finish();reject(new Error('smoke_transport_stopped'));};
      const query=request.query?.['x-id']?'?x-id='+operation:'';
      const outgoing=requestImpl({protocol:'https:',hostname,port:443,method:request.method,path:request.path+query,headers:{...request.headers,'accept-encoding':'identity'},maxHeaderSize:8192,agent:false,signal:controller.signal},incoming=>{
        void (async()=>{
          try {
            const status=incoming.statusCode??0;
            requireValue(status===(index===2?412:index===4?206:200) || (index<2 && status===412));
            requireValue(!incoming.headers['content-encoding'] || incoming.headers['content-encoding']==='identity');
            const cap=index===3?0:index===4?1024:2048;
            const length=incoming.headers['content-length'];
            requireValue(length===undefined || /^(0|[1-9][0-9]*)$/.test(length));
            if(index!==3 && length!==undefined)requireValue(Number(length)<=cap);
            const chunks:Buffer[]=[];let bytes=0;
            for await(const chunk of incoming){bytes+=chunk.length;requireValue(bytes<=cap);chunks.push(Buffer.from(chunk));}
            requireValue(index===3 || length===undefined || bytes===Number(length));
            const headers:Record<string,string>={};
            for(const [key,value] of Object.entries(incoming.headers))if(typeof value==='string')headers[key]=value;
            finish();resolve({response:{statusCode:status,headers,body:Readable.from([Buffer.concat(chunks)])}});
          } catch {incoming.destroy();outgoing.destroy();fail();}
        })();
      });
      outgoing.on('error',fail);
      outgoing.end(request.body);
    });
  }};
  const client=new S3Client({region:'auto',endpoint:config.endpoint,forcePathStyle:false,maxAttempts:1,credentials:{accessKeyId:env.PHOTO_FINALS_SMOKE_R2_ACCESS_KEY_ID!,secretAccessKey:env.PHOTO_FINALS_SMOKE_R2_SECRET_ACCESS_KEY!},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',requestHandler:handler});
  return {async send(command,options) {
    const result=await client.send(command,options);
    if('Body' in result)requireValue(result.Body instanceof Readable);
    return result as StorageResponse;
  },destroy:()=>client.destroy()};
}

function precondition(error:unknown) {
  const e=error as {name?:string; $metadata?:{httpStatusCode?:number}};
  return e?.name==='PreconditionFailed' && e.$metadata?.httpStatusCode===412;
}
function reply(status:number, result:string) {return Response.json({status:result},{status,headers:{'cache-control':'no-store'}});}
export function createOperatorSmokeHandler(deps:Dependencies) {
  return async (request:Request, enteredAt=Date.now()) => {
    if(deps.env.PHOTO_FINALS_OPERATOR_SMOKE_ENABLED!=='1')return reply(404,'disabled');
    let config:ReturnType<typeof loadSmokeAdmission>;
    try {config=loadSmokeAdmission(deps.env);} catch {return reply(503,'not-admitted');}
    const url=new URL(request.url);
    if(request.method!=='POST' || request.headers.get('content-length') && request.headers.get('content-length')!=='0' || url.origin!==config.origin || url.pathname!==PATH || url.search || request.headers.get('origin')!==config.origin || request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site')!=='same-origin')return reply(400,'invalid-request');
    const deadline=Math.min(config.expires,enteredAt+15000);
    const controller=new AbortController();
    const abort=()=>controller.abort(new Error('smoke_stopped'));
    const signal=controller.signal;
    const check=()=>{if(!Number.isFinite(deadline)||Date.now()>=deadline||request.signal.aborted)abort();signal.throwIfAborted();};
    request.signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,Math.max(1,deadline-Date.now()));
    let cancel:()=>void=()=>{};
    const stopped=new Promise<never>((_,reject)=>{cancel=()=>reject(new Error('smoke_stopped'));signal.addEventListener('abort',cancel,{once:true});});
    const run=async()=>{
      check();
      if(request.body) {
        const reader=request.body.getReader();
        const cancelBody=()=>{void reader.cancel().catch(()=>{});};
        signal.addEventListener('abort',cancelBody,{once:true});
        try {
          while(true) {const chunk=await reader.read();check();if(chunk.done)break;if(chunk.value.byteLength)return reply(400,'invalid-request');}
        } finally {signal.removeEventListener('abort',cancelBody);cancelBody();reader.releaseLock();}
      }
      const identity=await deps.authorize(request,signal);
      check();
      if(!identity || identity.actorId!==config.actorId || identity.organizationId!==config.organizationId || identity.role!=='admin' || identity.archivedAt!==null || !['owner','admin'].includes(identity.membershipRole))return reply(403,'denied');
      const storage=deps.storage(config,deps.env);
      try {
        const payload=Buffer.alloc(65536);for(let i=0;i<payload.length;i++)payload[i]=i%251;
        const digest=hash(payload);
        // Registered before the first write. The retained claim is never reset.
        const claim=Buffer.from(JSON.stringify({version:config.version,runId:config.runId,actorId:config.actorId,organizationId:config.organizationId,objectKey:config.objectKey,sha256:digest}));
        requireValue(claim.length<=1024);
        let operations=0,uploadBytes=0;
        const send=async(command:Command)=>{check();requireValue(++operations<=5);const result=await storage.send(command,{abortSignal:signal});check();return result;};
        const put=(key:string,body:Buffer)=>{
          uploadBytes+=body.length;requireValue(uploadBytes<=132096);
          return new PutObjectCommand({Bucket:config.bucket,Key:key,Body:body,ContentLength:body.length,ContentType:'application/octet-stream',Metadata:{sha256:hash(body)},IfNoneMatch:'*'});
        };
        try {const receipt=await send(put(config.claimKey,claim));requireValue(receipt.$metadata?.httpStatusCode===200 && receipt.ETag);}
        catch(error) {if(precondition(error))return reply(409,'stop-consumed');throw error;}
        const stored=await send(put(config.objectKey,payload));requireValue(stored.$metadata?.httpStatusCode===200 && stored.ETag);
        let refused=false;
        try {await send(put(config.objectKey,payload));} catch(error) {if(!precondition(error))throw error;refused=true;}
        requireValue(refused);
        const head=await send(new HeadObjectCommand({Bucket:config.bucket,Key:config.objectKey}));
        requireValue(head.$metadata?.httpStatusCode===200 && head.ETag===stored.ETag && head.ContentLength===payload.length && head.ContentType==='application/octet-stream' && head.Metadata?.sha256===digest);
        const range=await send(new GetObjectCommand({Bucket:config.bucket,Key:config.objectKey,Range:'bytes=1024-2047',IfMatch:stored.ETag}));
        const closeBody=()=>range.Body?.destroy(new Error('smoke_stopped'));
        signal.addEventListener('abort',closeBody,{once:true});
        try {
          requireValue(range.Body instanceof Readable && range.$metadata?.httpStatusCode===206 && range.ETag===stored.ETag && range.ContentLength===1024 && range.ContentRange==='bytes 1024-2047/65536' && range.ContentType==='application/octet-stream' && range.Metadata?.sha256===digest);
          const chunks:Buffer[]=[];let size=0;
          for await(const chunk of range.Body){check();size+=chunk.length;requireValue(size<=1024);chunks.push(Buffer.from(chunk));}
          requireValue(size===1024 && hash(Buffer.concat(chunks))===hash(payload.subarray(1024,2048)));
        } finally {signal.removeEventListener('abort',closeBody);range.Body?.destroy();}
        check();
        return Response.json({status:'verified-storage-smoke',certified:false,payloadBytes:payload.length,rangeBytes:1024,operations,uploadBytes},{headers:{'cache-control':'no-store'}});
      } finally {storage.destroy?.();}
    };
    try {return await Promise.race([run(),stopped]);}
    catch {return reply(503,'stop');}
    finally {clearTimeout(timer);request.signal.removeEventListener('abort',abort);signal.removeEventListener('abort',cancel);abort();}
  };
}
