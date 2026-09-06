import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../invoice.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const {QBOError}=require('../transport.ts');
function harness({receiptError=false,invoice={Id:'42',TotalAmt:100,Balance:100},postError=false,stageError=false}={}){
 const events=[];let claimed=false;
 const chain=data=>new Proxy({}, {get:(_,k)=>k==='then'?resolve=>resolve({data,error:null}):()=>chain(data)});
 const service={from:t=>chain(t==='bookings'?{organization_id:'org'}:t==='quickbooks_connection'?{default_item_id:'1'}:[]),rpc:async(name,args)=>{
  events.push(name);
  if(name==='request_quickbooks_invoice') return {data:true,error:null};
  if(name==='begin_quickbooks_invoice') {const data=claimed?{state:'unknown'}:{id:'intent',state:'processing',lease_token:'lease'};claimed=true;return {data,error:null};}
  if(name==='stage_quickbooks_invoice') return {data:!stageError,error:null};
  if(name==='finish_quickbooks_invoice') return {data:!receiptError,error:receiptError?{}:null};
  throw Error('Unexpected RPC '+name);
 }};
 const qb={realmId:'123',environment:'sandbox',query:async()=>({QueryResponse:{Customer:[{Id:'5'}]}}),request:async(path,init)=>{events.push('POST');assert.equal(path,'/invoice');assert.equal(init.query.requestid,'intent');assert.equal(init.body.PrivateNote,'pixel-invoice-intent:intent');if(postError)throw new QBOError('lost',0);return {Invoice:invoice}}};
 const exports={};
 vm.runInNewContext(compiled,{exports,console:{error(){},warn(){}},Date,require:p=>p==='server-only'?{}:p==='@/lib/booking/services'?{}:p==='@/lib/supabase/server'?{getServiceSupabase:()=>service}:p==='./client'?{getQBClient:async()=>qb,QBOError}:require(p.replace('./','../'))});
 const input={bookingId:'booking',services:[],addOns:[],realtor:{email:'a@example.test'},property:{street_address:'Test'},lineItems:[{description:'Photo',amountCents:10000}]};
 return {events,run:()=>exports.createInvoiceForBooking(input)};
}
test('real invoice path gates POST on durable staging and fails closed on local receipt failure',async()=>{
 for(const options of [{receiptError:true},{postError:true},{invoice:{Id:'42'}},{stageError:true}]){
  const h=harness(options);assert.equal((await h.run()).ok,false);assert.equal((await h.run()).ok,false);
  assert.equal(h.events.filter(e=>e==='POST').length,options.stageError?0:1);
  if(!options.stageError)assert.ok(h.events.indexOf('stage_quickbooks_invoice')<h.events.indexOf('POST'));
 }
 const h=harness();assert.equal((await h.run()).ok,true);assert.ok(h.events.includes('finish_quickbooks_invoice'));
});
