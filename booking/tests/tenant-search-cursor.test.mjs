import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import ts from 'typescript';
test('route cursors validate complete composite keys without timestamp rounding',()=>{
 const path=new URL('../lib/booking/admin-search-cursor.ts',import.meta.url);
 assert.ok(existsSync(path),'composite cursor parser required');
 const exports={}; new Function('exports',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports);
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const job={id,priority:0,scheduled_at:null,created_at:'2026-01-01T12:00:00.123456+00:00'};
 const realtor={id,full_name:null,email:'a@test'};
 for(const [kind,value] of [['booking',job],['realtor',realtor]]) {
  assert.deepEqual(exports.parseAdminSearchCursor(JSON.stringify(value),kind),value);
  for(const key of Object.keys(value)) {const bad={...value};delete bad[key];assert.equal(exports.parseAdminSearchCursor(JSON.stringify(bad),kind),null,key);}
  for(const bad of [id,'{}','[]','null','oops',JSON.stringify({...value,id:'bad'})]) assert.equal(exports.parseAdminSearchCursor(bad,kind),null);
 }
 assert.equal(exports.parseAdminSearchCursor(JSON.stringify({...job,priority:2}),'booking'),null);
 assert.equal(exports.parseAdminSearchCursor(JSON.stringify({...job,created_at:'2026-02-30T00:00:00Z'}),'booking'),null);
 for(const page of ['bookings','realtors']) {
  const source=readFileSync(new URL(`../app/admin/${page}/page.tsx`,import.meta.url),'utf8');
  assert.match(source,/parseAdminSearchCursor\(params.after/);
  assert.match(source,/JSON.stringify\(.*_cursor/);
  assert.doesNotMatch(source,/stable ID order/);
 }
});
