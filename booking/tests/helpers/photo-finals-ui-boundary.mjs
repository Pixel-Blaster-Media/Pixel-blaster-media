import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Exact approved functional slice, not a weakening of the historical skin-only
// proof. Undo only these frozen hunks, then run the original byte comparisons.
const delta=JSON.parse(readFileSync(new URL('./photo-finals-authorized-ui-delta.json',import.meta.url),'utf8'));
export function beforeFinalsUi(path,source){
 for(const [candidate,prior] of delta[path]??[]){assert.equal(source.split(candidate).length-1,1,'exact finals UI hunk: '+path);source=source.replace(candidate,prior);}
 return source;
}
