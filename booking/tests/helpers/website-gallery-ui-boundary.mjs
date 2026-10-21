import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const delta=JSON.parse(readFileSync(new URL('./website-gallery-ui-delta.json',import.meta.url),'utf8'));
export const websiteGalleryUiPaths=Object.keys(delta);
export function beforeWebsiteGalleryUi(path,source){
 for(const[candidate,prior]of delta[path]??[]){
  assert.equal(source.split(candidate).length-1,1,'exact website gallery UI hunk: '+path);
  source=source.replace(candidate,()=>prior);
 }
 return source;
}
