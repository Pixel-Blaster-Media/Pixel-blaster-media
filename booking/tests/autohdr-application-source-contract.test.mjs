import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const route = (name) => `app/api/admin/bookings/[id]/autohdr/${name}/route.ts`;

test("AutoHDR routes authenticate before delegated tenant-qualified workflows and sanitize errors", () => {
  const delegates = {
    prepare: "prepareBookingAutoHDR",
    finalize: "finalizeBookingAutoHDR",
    refresh: "refreshBookingAutoHDR",
    retrieve: "retrieveBookingAutoHDR",
  };
  for (const name of Object.keys(delegates)) {
    assert.equal(existsSync(new URL(route(name), root)), true, `missing ${name} route`);
    const source = read(route(name));
    assert.ok(
      source.indexOf("await requireAdmin()") < source.indexOf(`await ${delegates[name]}(`),
    );
    assert.match(source, /readBoundedAutoHDRJson/);
    assert.match(source, /toAutoHDRRouteError/);
    assert.doesNotMatch(source, /String\(err(or)?\)|err(or)?\.message/);
  }
  assert.match(read(route("finalize")), /parseAutoHDRJobOnlyInput/);
  assert.match(read(route("refresh")), /parseAutoHDRJobOnlyInput/);
  assert.match(read(route("retrieve")), /parseAutoHDRJobOnlyInput/);
});

test("database boundary centralizes the separately-owned RPC names and never stores URLs", () => {
  const adapter = read("lib/integrations/autohdr/database-adapter.ts");
  for (const rpc of [
    "claim_autohdr_job",
    "transition_autohdr_job",
    "assign_autohdr_provider_uid",
    "claim_autohdr_retrieval",
  ]) {
    assert.match(adapter, new RegExp(rpc));
  }
  assert.match(adapter, /AUTOHDR_DATABASE_CONTRACT/);
  assert.doesNotMatch(adapter, /upload_url|processed_url|uploaded_files/);
});

test("status never retrieves renders and blocked retrieval never calls the processed endpoint", () => {
  const workflow = read("lib/integrations/autohdr/application-core.ts");
  const refreshStart = workflow.indexOf("async function refresh");
  const retrieveStart = workflow.indexOf("async function retrieve");
  assert.ok(refreshStart >= 0 && retrieveStart > refreshStart);
  assert.doesNotMatch(workflow.slice(refreshStart, retrieveStart), /getProcessedPhotos/);
  assert.doesNotMatch(workflow.slice(retrieveStart), /getProcessedPhotos|claimRetrieval/);
  assert.match(workflow.slice(retrieveStart), /secure_ingestion_prerequisite/);
});

test("MediaWorkflow swaps gated prose for the compact runtime-gated AutoHDR UI", () => {
  const mediaWorkflow = read("app/admin/bookings/[id]/MediaWorkflow.tsx");
  const section = read("app/admin/bookings/[id]/AutoHDRSection.tsx");
  const page = read("app/admin/bookings/[id]/page.tsx");
  const readiness = read("lib/integrations/autohdr/readiness.ts");
  assert.match(mediaWorkflow, /autoHDRReadiness\.ready \? autoHDR/);
  assert.match(mediaWorkflow, /Prerequisite/);
  assert.doesNotMatch(mediaWorkflow, /presigned-upload contract, zero-credit test mode/);
  assert.match(page, /getAutoHDRRuntimeReadiness/);
  assert.match(readiness, /createProductionR2Storage/);
  assert.match(section, /Review pending ingestion/);
  assert.doesNotMatch(section, /ready for delivery/i);
  assert.doesNotMatch(section, /iGUIDE/i);
});

test("retrieval documents the exact safe streaming prerequisite instead of buffering", () => {
  const prerequisite = read("lib/integrations/autohdr/retrieval-prerequisite.ts");
  assert.match(prerequisite, /DNS-pinned/);
  assert.match(prerequisite, /expected SHA-256/);
  assert.match(prerequisite, /createProductionR2Storage/);
  assert.doesNotMatch(prerequisite, /arrayBuffer\(|Buffer\.from\(/);
});
