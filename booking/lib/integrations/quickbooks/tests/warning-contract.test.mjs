import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const root=new URL('../../../../',import.meta.url);
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function ast(path){return ts.createSourceFile(path,readFileSync(new URL(path,root),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)}
const assistant=ast('app/admin/assistant/actions.ts');
const fn=assistant.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='executeConfirmedAssistantAction');
const ui=ast('app/admin/bookings/[id]/BookingActions.tsx');
let callback;
function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ui)==='startTransition'&&n.getText(ui).includes('sendDeliveryReadyEmail'))callback=n.arguments[0];ts.forEachChild(n,visit)}
visit(ui);
// Execute the actual UI transition callback, observing the alert/message state.
for(const outcome of [{ok:true,recipientCount:1},{ok:false,error:'Delivery email could not be sent.'},{ok:false,error:'Email skipped.'},{ok:false,error:'Sent but receipt failed.'}]){
 test(`warning reaches assistant and UI: ${outcome.error??'success'}`,async()=>{
  const billingWarning='SENTINEL_BILLING_ATTENTION';
  const context={sendDeliveryReadyEmail:async()=>({...outcome,billingWarning}),bookingId:'fixture',extraRecipients:'',setError:e=>context.error=e,setMessage:m=>context.message=m,setSentAt:()=>{}};
  vm.runInNewContext(compile(fn.getText(assistant)+'\nglobalThis.execute=executeConfirmedAssistantAction;'),context);
  const result=await context.execute({}, {type:'send_delivery_email',bookingId:'fixture'});
  assert.ok(result.message.includes(billingWarning),'assistant warning missing');
  assert.equal(result.ok,outcome.ok);
  if(!outcome.ok)assert.ok(result.message.includes(outcome.error));
  vm.runInNewContext(compile('globalThis.run='+callback.getText(ui)),context);
  await context.run();
  assert.ok(context.error?.includes(billingWarning),'UI warning missing');
  if(!outcome.ok){assert.ok(context.error.includes(outcome.error));assert.equal(context.message,undefined)}
 });
}
// Reuse the real delivery action harness, not an alternate implementation.
const harness=readFileSync(new URL('lib/integrations/quickbooks/tests/delivery.test.mjs',root),'utf8');
const runSource=harness.slice(harness.indexOf('async function run('),harness.indexOf("test('delivery receipt"));
const actionAst=ast('app/admin/bookings/[id]/actions.ts');
const action=actionAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='sendDeliveryReadyEmail').getText(actionAst);
const context={ts,vm,action};
vm.runInNewContext(runSource+'\nglobalThis.run=run;',context);
for(const [name,sent,receipt] of [['rejected',{ok:false},null],['skipped',{ok:true,skipped:true},null],['receipt failure',{ok:true},{code:'23505'}]])test(`delivery preserves billing warning on ${name}`,async()=>{const {result}=await context.run(sent,true,receipt);assert.equal(result.ok,false);assert.match(result.billingWarning??'',/billing needs attention/)});
