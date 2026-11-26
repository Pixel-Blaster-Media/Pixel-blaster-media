import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const calls = [];
let reply;
const source = readFileSync(new URL("../lib/email/templates.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
vm.runInThisContext("(function(exports, require, fetch) {" + outputText + "\n})")(
  exports, () => ({}), async (...args) => { calls.push(args); return reply; });
const { deliveryReadyEmail, parseIGuideDeliveryMeasurements, resolveIGuideDeliveryMeasurements } = exports;

const example = { status: "ready", summary: { buildings: [{
  name: "Main & Building", intAreaAboveGrade: 169718633, extAreaAboveGrade: 188956489.5,
  excludedAreaAboveGrade: 59955512, floors: [
    { name: "MAIN FLOOR", interiorArea: 81467803, exteriorArea: 90470962.5,
      wallThickness: 229, rooms: [
        { name: "<Kitchen>", dims: [4724, 3169], area: 14957400 },
        { name: "Foyer", dims: [2965, 3378] },
      ] },
    { name: "BASEMENT", isBelowGrade: true, interiorArea: 78182562 },
  ],
}] } };
const input = { contactName: "Test Realtor", streetAddress: "Synthetic Listing",
  portalLink: "https://example.invalid/portal", deliverables: [] };

test("measurements render below media with the documented units and preserve optional fields", () => {
  const measurements = parseIGuideDeliveryMeasurements(example);
  const { html } = deliveryReadyEmail({ ...input, measurements });
  for (const value of ["Property details", "Main &amp; Building", "1,826.84 sq ft",
    "2,033.91 sq ft", "876.91 sq ft", "841.55 sq ft", "9.0 in",
    "&lt;Kitchen&gt;", "15′ 6″ × 10′ 5″ · 161 sq ft", "BASEMENT (below grade)"]) assert.ok(html.includes(value), value);
  assert.ok(!html.includes("<Kitchen>"));
  const foyer = html.match(/Foyer<\/th><td[^>]*>([^<]+)/)?.[1];
  assert.equal(foyer, "9′ 9″ × 11′ 1″");
  assert.ok(html.indexOf("Open your media") < html.indexOf("Property details"));
});
test("unavailable views never produce measurements or break the base email", () => {
  for (const payload of [null, { status: "locked", summary: example.summary }, {status:"ready", summary:{ buildings: [] }}]) {
    assert.equal(parseIGuideDeliveryMeasurements(payload), null);
    assert.ok(!deliveryReadyEmail({ ...input, measurements: parseIGuideDeliveryMeasurements(payload) }).html.includes("Property details"));
  }
});
test("only an exact iGUIDE view alias is fetched and redirects are refused", async () => {
  reply = new Response(JSON.stringify(example), { headers: { "content-type": "application/json" } });
  assert.ok(await resolveIGuideDeliveryMeasurements("https://youriguide.com/example_listing/"));
  assert.equal(calls.at(-1)[0], "https://youriguide.com/example_listing/data/summary");
  assert.equal(calls.at(-1)[1].redirect, "error");
  for (const invalid of ["https://youriguide.com.evil.invalid/example", "https://youriguide.com/example/doc/floorplan.pdf"]) {
    assert.equal(await resolveIGuideDeliveryMeasurements(invalid), null);
  }
  assert.equal(calls.length, 1);
  reply = new Response(JSON.stringify(example), { status: 403, headers: { "content-type": "application/json" } });
  assert.equal(await resolveIGuideDeliveryMeasurements("https://youriguide.com/example_listing/"), null);
});
