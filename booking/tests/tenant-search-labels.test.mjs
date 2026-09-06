import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../lib/booking/services.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};
new Function('exports',compiled)(exports);
const keys=[...source.matchAll(/(?:id: "([^"]+)"|^  (\w+): ")/gm)].map(m=>m[1]??m[2]);
const sql=readFileSync(new URL('../supabase/migrations/20260905100400_admin_search.sql',import.meta.url),'utf8');
test('SQL service labels cover every labelForService mapping and raw fallback',()=>{
 const mappings=Object.fromEntries([...sql.matchAll(/when '([^']+)' then '([^']+)'/g)].map(m=>[m[1],m[2]]));
 for(const key of [...keys,'unknown_custom_service']) {
  // Existing add-on label search is also retained; service labels must match exactly.
  const expected=exports.labelForService(key);
  if(expected!==key) assert.equal(mappings[key],expected,key);
 }
 assert.match(sql,/else s end/);
});
