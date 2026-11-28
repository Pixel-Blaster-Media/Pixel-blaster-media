import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/integrations/iguide/sync.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const exports = {};
vm.runInThisContext("(function(exports, require) {" + outputText + "\n})")(exports, () => ({}));
const { readyAddressKey } = exports;
const address = (street, unit, city = "Burlington", postal = "L7S 2H7") => readyAddressKey(street, unit, city, postal);

test("booking and iGUIDE formats agree when the building and explicit unit agree", () => {
  const booking = address("895 Maple Avenue", "unit 523");
  assert.ok(booking);
  assert.equal(booking, address("895 Maple Ave", "523"));
  assert.equal(booking, address("523-895 Maple Ave", null));
  assert.equal(booking, address("895 Maple Ave, Unit 523", null));
  assert.equal(booking, address("895 Maple Avenue", "unit unit 523", "burlington", "L7S2H7"));
});
test("matches never fall back to the building or cross units and reject conflicting data", () => {
  const booking = address("895 Maple Avenue", "unit 523");
  assert.notEqual(booking, address("895 Maple Ave", "537"));
  assert.notEqual(booking, address("895 Maple Ave", null));
  assert.notEqual(booking, address("895 Maple Ave", "523", "Hamilton"));
  assert.notEqual(booking, address("895 Maple Ave", "523", "Burlington", "L7S 2H8"));
  assert.equal(address("523-895 Maple Ave", "537"), null);
  assert.equal(address("895 Maple Ave, Unit 523", "unit"), null);
});
test("standalone houses still match without a unit", () => {
  const expected = address("118 Cameron Avenue N", null, "Hamilton", "L8H 4Z4");
  assert.ok(expected);
  assert.equal(expected, address("118 Cameron Ave N", null, "Hamilton", "L8H4Z4"));
  assert.notEqual(expected, address("118 Cameron Ave S", null, "Hamilton", "L8H4Z4"));
});
