import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const path = new URL('../lib/booking/listing-tenant-boundary.ts', import.meta.url);
const source = readFileSync(path, 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS });
const exports = {};
new Function('exports', js)(exports);
const valid = exports.validListingRelations;
const website = { organization_id:'tenant-a', owner_id:'owner-a', property_id:'property-a', booking_id:null };
const property = { id:'property-a', organization_id:'tenant-a', owner_id:'owner-a' };
test('renderer rejects a malicious foreign property independently of SQL/RLS', () => {
  assert.equal(valid(website, {...property, organization_id:'tenant-b'}), false);
  assert.equal(valid(website, {...property, owner_id:'owner-b'}), false);
  assert.equal(valid(website, {...property, id:'property-b'}), false);
});
test('renderer requires the complete optional booking relation', () => {
  const w = {...website, booking_id:'booking-a'};
  const b = {...property, id:'booking-a', property_id:'property-a'};
  assert.equal(valid(w, property, null), false);
  assert.equal(valid(w, property, {...b, organization_id:'tenant-b'}), false);
  assert.equal(valid(w, property, {...b, property_id:'property-b'}), false);
  assert.equal(valid(w, property, {...b, owner_id:'owner-b'}), false);
  assert.equal(valid(w, property, b), true);
});
test('renderer allows coherent properties with no booking', () => {
  assert.equal(valid(website, property, null), true);
  assert.equal(valid({...website, organization_id:null}, {...property, organization_id:null}), false);
});
