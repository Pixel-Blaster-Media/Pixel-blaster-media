import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Local functional audit changes are frozen as exact hunks. Reverse only these
// hunks so earlier presentation-only guards continue to check their full scope.
const delta=JSON.parse(readFileSync(new URL('./booking-audit-ui-delta.json',import.meta.url),'utf8'));
export const bookingAuditUiPaths=Object.keys(delta);
export function beforeBookingAuditUi(path,source){
 for(const [candidate,prior] of delta[path]??[]){
  assert.equal(source.split(candidate).length-1,1,'exact booking audit UI hunk: '+path);
  source=source.replace(candidate,()=>prior);
 }
 return source;
}
