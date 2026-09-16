import type {Progress} from './transfer';
export class TransferBudgetExhausted extends Error {}

/** Only closed local categories reach the UI; never provider/DOM error prose. */
export function recoveryProgress(error:unknown,bytes=0):Progress {
 if(error instanceof TransferBudgetExhausted)return {state:'budget-exhausted',bytes,error:'This package reached its transfer safety limit. Contact support. Retained progress is unchanged; Discard, sign-in, or a new transfer cannot reset the limit.'};
 const name=error instanceof Error?error.name:'';
 if(name==='QuotaExceededError')return {state:'quota',bytes,error:'Temporary browser storage is full. Free space, then Retry to recheck retained progress. Saving a ZIP also needs space.'};
 if(name==='SecurityError'||name==='NotAllowedError'||name==='NotSupportedError')return {state:'unsupported',bytes,error:'Temporary browser storage is unavailable. Private browsing or browser settings may prevent it. Use a normal window with storage allowed, then Retry.'};
 return {state:'error',bytes,error:'Download could not be completed. Retry to recheck retained progress and current access. If it continues, contact support.'};
}
