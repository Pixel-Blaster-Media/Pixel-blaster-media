import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {persistInvoiceReceipt, validateInvoiceReceipt}=require('../receipt.ts');
const invoice={Id:'42',TotalAmt:100,Balance:100};
test('provider success is not success when durable atomic receipt fails', async()=>{
 for(const settle of [async()=>false,async()=>{throw Error('lost response')}]) {
  const result=await persistInvoiceReceipt(invoice,settle);
  assert.equal(result.ok,false); assert.equal(result.outcome,'unknown');
 }
});
test('missing balance/total and invalid identity fail closed before persistence',async()=>{
 for(const inv of [{Id:'42'}, {...invoice,Balance:undefined},{...invoice,TotalAmt:NaN},{...invoice,Id:'42/x'}]) {
  let calls=0; const result=await persistInvoiceReceipt(inv,async()=>{calls++;return true});
  assert.equal(result.ok,false);assert.equal(calls,0);
 }
 assert.equal(validateInvoiceReceipt({...invoice,Balance:0}).status,'paid');
 assert.equal((await persistInvoiceReceipt(invoice,async()=>true)).ok,true);
});
