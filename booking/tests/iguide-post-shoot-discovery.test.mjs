import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  });
  const exports = {};
  vm.runInThisContext("(function(exports, require) {" + outputText + "\n})")(
    exports, (key) => imports[key] ?? {},
  );
  return exports;
}
const sync = load("../lib/integrations/iguide/sync.ts", {});
const {discoveryDue, projectDiscoveryTour, selectDiscoveryTour} = load(
  "../lib/integrations/iguide/post-shoot-discovery-core.ts", {"./sync":sync},
);
const end = Date.parse("2026-12-01T17:15:00Z");
const booking = {id:"one",status:"confirmed",scheduled_at:"2026-12-01T15:00:00Z",
 scheduled_ends_at:new Date(end).toISOString(),iguide_id:null,iguide_portal_id:null,
 unit_number:"Unit 523",properties:{street_address:"895 Maple Avenue",city:"Burlington",postal_code:"L7S 2H7"}};
function tour(unit, status, params = {}) {
  const property = {streetNumber:"895",streetName:"Maple Ave",unit,city:"Burlington",postalCode:"L7S2H7"};
  return projectDiscoveryTour({id:"igExample1",raw:{property},status,createdAt:"2026-12-01T16:03:00Z",...params});
}

test("start at scheduled end, not at upload time or for cancelled, already linked or old jobs", () => {
  assert.equal(discoveryDue(booking,end-1),false);
  assert.equal(discoveryDue(booking,end),true);
  assert.equal(discoveryDue({...booking,status:"cancelled"},end),false);
  assert.equal(discoveryDue({...booking,iguide_portal_id:"igExisting"},end),false);
  assert.equal(discoveryDue({...booking,scheduled_ends_at:null},end),false);
  assert.equal(discoveryDue(booking,end+36*60*60*1000),false);
});
test("find uploads from during the shoot and distinguish creation from actual processing", () => {
  const empty = tour("523","empty");
  const pick = (t) => selectDiscoveryTour(booking,[booking],[t],end);
  assert.equal(pick(empty).stage,"awaiting_upload");
  assert.equal(pick(tour(523,"pending_draft")).stage,"processing");
  assert.equal(pick(tour("523",null)).stage,"found");
  assert.equal(pick(tour("523","published")).stage,"published");
  assert.equal(pick(tour("523","pending_draft",{createdAt:"2026-12-01T17:20:00Z"})),null);
});
test("ignore the wrong unit, missing unit, duplicate tours and competing bookings", () => {
  assert.equal(selectDiscoveryTour(booking,[booking],[tour("537","processing"),tour(null,"processing")],end),null);
  assert.equal(selectDiscoveryTour(booking,[booking],[tour("523","processing"),tour("523","processing",{id:"igExample2"})],end),null);
  assert.equal(selectDiscoveryTour(booking,[booking,{...booking,id:"two"}],[tour("523","processing")],end),null);
  assert.equal(tour("523","processing",{raw:{address:"895 Maple Ave"}}),null);
});
