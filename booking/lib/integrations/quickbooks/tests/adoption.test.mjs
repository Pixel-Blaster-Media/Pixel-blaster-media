import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {verifyAdoption}=require('../adoption.ts');
const body={PrivateNote:'pixel-invoice-intent:abc',CustomerRef:{value:'5'},Line:[{DetailType:'SalesItemLineDetail',Amount:100,Description:'Photo',SalesItemLineDetail:{ItemRef:{value:'1'},Qty:1,UnitPrice:100}}]};
const invoice={...body,Id:'42',TotalAmt:100,Balance:100};
test('adoption rejects wrong identity, correlation, customer, line and missing evidence',()=>{
 assert.equal(verifyAdoption(invoice,body,'42').invoiceId,'42');
 for(const inv of [{...invoice,Id:'43'},{...invoice,PrivateNote:'other'},{...invoice,CustomerRef:{value:'6'}},{...invoice,Line:[]},{...invoice,Balance:undefined}]) assert.throws(()=>verifyAdoption(inv,body,'42'));
 assert.throws(()=>verifyAdoption(invoice,null,'42'));
});
