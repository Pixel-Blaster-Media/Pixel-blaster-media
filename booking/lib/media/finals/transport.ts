import { createClient } from '@supabase/supabase-js';
import type { FinalsDatabase } from './ingest.ts';
import { FINALS_OPERATIONS } from './rpc-adapter.ts';
/** Fixed Supabase origin only. One deadline covers headers AND streamed JSON.
 * No redirect, retry, unbounded SDK response aggregation or provider error leak. */
export function boundedFinalsFetch(origin:string,transport:typeof fetch=fetch,timeoutMs=10_000):typeof fetch{
 if(!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(origin)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10_000)throw new Error('finals_transport_config');
 return async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin!==origin||url.search||url.hash||url.username||url.password||!url.pathname.startsWith('/rest/v1/rpc/')||!FINALS_OPERATIONS.has(url.pathname.slice('/rest/v1/rpc/'.length))||init?.method!=='POST'||typeof init.body!=='string'||Buffer.byteLength(init.body)>(url.pathname==='/rest/v1/rpc/photo_finals_package_finish_indexed'?2097152:262144))throw new Error('finals_transport_request');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const signal=init.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   signal.throwIfAborted();
   const response=await transport(url,{...init,redirect:'error',cache:'no-store',signal,headers:{...Object.fromEntries(new Headers(init.headers)),Accept:'application/json','Accept-Encoding':'identity'}});
   signal.throwIfAborted();
   if(response.status===204){
    const voidOps=new Set(['access','stage','fail','download_revoke','package_heartbeat','package_checkpoint','package_finish','package_finish_indexed','package_fail'].map(n=>'photo_finals_'+n));
    if(!voidOps.has(url.pathname.slice('/rest/v1/rpc/'.length))||response.body!==null)throw new Error('finals_transport_response');
    return new Response(null,{status:204});
   }
   reader=response.body?.getReader();
   const budgetError=response.status===500&&(url.pathname.endsWith('/photo_finals_chunk_begin')||url.pathname.endsWith('/photo_finals_transfer_begin'));
   const bound=budgetError?4096:2097152;
   const length=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
   if((response.status!==200&&!budgetError)||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')||(encoding!==null&&encoding!=='identity')||(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>bound)))throw new Error('finals_transport_response');
   const chunks:Uint8Array[]=[];let bytes=0;
   if(!reader)throw new Error('finals_transport_response');
   for(;;){signal.throwIfAborted();const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>bound)throw new Error('finals_transport_response');chunks.push(next.value);}
   signal.throwIfAborted();if(length!==null&&bytes!==Number(length))throw new Error('finals_transport_response');
   if(budgetError){
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const message=url.pathname.endsWith('/photo_finals_chunk_begin')?'finals_attempt_budget':'finals_transfer_limit';
    if(value?.code!=='54000'||value.message!==message)throw new Error('finals_transport_response');
    return Response.json({code:'54000',message},{status:500});
   }
   return new Response(Buffer.concat(chunks),{status:200,headers:{'content-type':'application/json'}});
  }catch{throw new Error('finals_transport_unconfirmed');}
  finally{controller.abort();clearTimeout(timer);void reader?.cancel().catch(()=>{});}
 };
}
export function createProductionFinalsDatabase(config:{supabaseUrl:string;serviceKey:string}):FinalsDatabase{
 return createClient(config.supabaseUrl,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:boundedFinalsFetch(config.supabaseUrl)}});
}
