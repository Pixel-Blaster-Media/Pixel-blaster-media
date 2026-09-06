export interface InvoiceReceipt { invoiceId: string; totalCents: number; balanceCents: number; status: 'open'|'paid'; invoiceNumber: string|null }
export function validateInvoiceReceipt(value: unknown): InvoiceReceipt {
 if (!value || typeof value !== 'object') throw Error('Invalid invoice receipt');
 const inv=value as Record<string,unknown>;
 if (typeof inv.Id !== 'string' || !/^[0-9]{1,64}$/.test(inv.Id)) throw Error('Invalid invoice identity');
 const cents=(n:unknown)=> {
  if(typeof n!=='number' || !Number.isFinite(n) || n<0 || !Number.isSafeInteger(Math.round(n*100)) || Math.round(n*100)>2147483647 || Math.abs(n*100-Math.round(n*100))>0.00001) throw Error('Invalid invoice amount');
  return Math.round(n*100);
 };
 const totalCents=cents(inv.TotalAmt), balanceCents=cents(inv.Balance);
 if(balanceCents>totalCents || (inv.DocNumber!==undefined && (typeof inv.DocNumber!=='string' || inv.DocNumber.length>128))) throw Error('Invalid invoice receipt');
 return {invoiceId:inv.Id,totalCents,balanceCents,status:balanceCents>0?'open':'paid',invoiceNumber:typeof inv.DocNumber==='string'?inv.DocNumber:null};
}
export async function persistInvoiceReceipt(value:unknown, settle:(receipt:InvoiceReceipt)=>Promise<boolean>) {
 try {
  const receipt=validateInvoiceReceipt(value);
  if(await settle(receipt)) return {ok:true as const,outcome:'confirmed' as const,...receipt};
 } catch { /* Retain the durable lease/intent for reconciliation; never retry POST. */ }
 return {ok:false as const,outcome:'unknown' as const,error:'Invoice outcome requires reconciliation; no new invoice was authorized.'};
}
