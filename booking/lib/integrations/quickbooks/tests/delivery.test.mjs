import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../../../../app/admin/bookings/[id]/actions.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('actions.ts',source,ts.ScriptTarget.Latest,true);
const action=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='sendDeliveryReadyEmail').getText(ast);
async function run(sent,billing=false,notificationError=null){
 let writes=0;
 const chain=(data)=>new Proxy({}, {get:(_,key)=>key==='then'?(resolve)=>resolve({data,error:null}):key==='upsert'?()=>{writes++;return Promise.resolve({error:notificationError})}:()=>chain(data)});
 const exports={};
 const context={exports,process:{env:{}},console,Date,requireAdminForBooking:async()=>({organizationId:'org',email:'admin@example.test'}),getServiceSupabase:()=>({from:t=>chain(t==='bookings'?{id:'booking',property_id:'property',properties:{street_address:'Test'},profiles:{email:'a@example.test'}}:t==='deliverables'?[{url:'https://example.test',source:'iguide'}]:null)}),parseRecipientEmails:()=>[],uniqueEmails:x=>x,getOrganizationEmailSettings:async()=>({invoiceTiming:billing?'on_delivery':'on_booking'}),createInvoiceForBookingId:async()=>({ok:false}),deliveryReadyEmail:()=>({subject:'Delivery',html:'Links'}),buildDeliveryLinks:()=>[],sendEmail:async()=>sent,sendPushBestEffort:async()=>{},revalidatePath:()=>{}};
 vm.runInNewContext(ts.transpileModule(action,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 return {result:await exports.sendDeliveryReadyEmail('booking'),writes};
}
test('delivery receipt uniqueness failure is not reported as recorded success',async()=>{
 const {result,writes}=await run({ok:true,id:'message'},false,{code:'23505'});
 assert.equal(writes,1);
 assert.equal(result.ok,false);
 assert.match(result.error,/sent.*record could not be saved/i);
});
test('real delivery action does not stamp skipped email',async()=>{const {result,writes}=await run({ok:true,skipped:true});assert.equal(result.ok,false);assert.equal(writes,0);assert.match(result.error,/not configured|skipped/i)});
test('real delivery action preserves delivery with visible billing warning',async()=>{const {result,writes}=await run({ok:true,id:'message'},true);assert.equal(result.ok,true);assert.equal(writes,1);assert.match(result.billingWarning,/invoice|billing/i)});
