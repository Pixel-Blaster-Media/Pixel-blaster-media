import {validateInvoiceReceipt} from './receipt';
type Obj=Record<string,unknown>;
function object(v:unknown):Obj {if(!v || typeof v!=='object' || Array.isArray(v)) throw Error('Missing adoption evidence');return v as Obj;}
export function verifyAdoption(value:unknown,expected:unknown,invoiceId:string) {
 const inv=object(value), body=object(expected), receipt=validateInvoiceReceipt(inv);
 if(receipt.invoiceId!==invoiceId || typeof body.PrivateNote!=='string' || inv.PrivateNote!==body.PrivateNote || object(inv.CustomerRef).value!==object(body.CustomerRef).value) throw Error('Invoice identity mismatch');
 const lines=(v:unknown)=>{
  if(!Array.isArray(v)) throw Error('Missing invoice lines');
  if(v.some(l=>!['SalesItemLineDetail','SubTotalLineDetail'].includes(String(object(l).DetailType)))) throw Error('Unsupported invoice line');
  return v.filter(l=>object(l).DetailType==='SalesItemLineDetail').map(l=>{
   const line=object(l), detail=object(line.SalesItemLineDetail);
   return [line.Amount,line.Description,object(detail.ItemRef).value,detail.Qty,detail.UnitPrice];
  });
 };
 const expectedLines=lines(body.Line);
 const expectedTotal=expectedLines.reduce((total,line)=>total+Number(line[0]),0);
 if(!Number.isFinite(expectedTotal) || Math.round(expectedTotal*100)!==receipt.totalCents) throw Error('Invoice total mismatch');
 if(!expectedLines.length || JSON.stringify(lines(inv.Line))!==JSON.stringify(expectedLines)) throw Error('Invoice lines mismatch');
 return receipt;
}
