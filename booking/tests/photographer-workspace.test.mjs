import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tabs = readFileSync(new URL("../app/admin/bookings/[id]/BookingWorkspaceTabs.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/admin/bookings/[id]/page.tsx", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../app/admin/bookings/[id]/MediaWorkflow.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("../app/admin/bookings/[id]/BookingActions.tsx", import.meta.url), "utf8");

test("photographer workspace has four purpose-driven tabs", () => {
  assert.match(tabs, /"media"[\s\S]*"website"[\s\S]*"delivery"[\s\S]*"details"/);
  assert.doesNotMatch(tabs, /id:\s*"billing"/);
  assert.match(tabs, /label:\s*"Website"/);
});

test("billing is consolidated into Details instead of owning a top-level tab", () => {
  assert.doesNotMatch(page, /billing=\{/);
  assert.match(page, /<DetailsTab[\s\S]*invoice=/);
  assert.match(page, /<InvoiceSection/);
  assert.match(page, /raw === "billing"\) return "details"/);
});

test("Media presents one guided workflow and keeps recovery history visible behind setup", () => {
  assert.match(workflow, /Upload[\s\S]*Review[\s\S]*Prepare[\s\S]*Ready/);
  assert.match(workflow, /Planned delivery flow/);
  assert.doesNotMatch(workflow, /index === 0/);
  assert.match(workflow, /Primary media source/);
  assert.match(workflow, /Source connections and fallback/);
  assert.match(workflow, /Manual photo upload/);
  assert.match(workflow, /manual\/canonical JPG upload is not enabled in this preview/);
  assert.match(workflow, /autoenhanceEnabled \? " Autoenhance remains available under source connections\."/);
  assert.doesNotMatch(workflow, /autoHDREnabled \? \(/);
  assert.match(workflow, /Existing job history remains visible/);
  assert.match(workflow, /autoenhanceEnabled \? \(/);
  assert.doesNotMatch(workflow, /type="file"/);
});

test("manual photo links can be assigned to an explicit delivery slot", () => {
  assert.match(actions, /name="delivery_kind"/);
  assert.match(actions, /value="mls"/);
  assert.match(actions, /value="high_res"/);
});
