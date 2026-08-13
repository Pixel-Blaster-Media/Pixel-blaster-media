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

test("canonical source routes authenticate before prepare or acceptance and keep signed URLs out of persistence", () => {
  const delegates = {
    "source/prepare": "prepareBookingAutoHDRSourceUpload",
    "source/accept": "acceptBookingAutoHDRSourceUpload",
  };
  for (const [name, delegate] of Object.entries(delegates)) {
    assert.equal(existsSync(new URL(route(name), root)), true, `missing ${name} route`);
    const source = read(route(name));
    assert.ok(source.indexOf("await requireAdmin()") < source.indexOf(`await ${delegate}(`));
    assert.match(source, /readBoundedAutoHDRJson/);
    assert.match(source, /toAutoHDRRouteError/);
    assert.doesNotMatch(source, /String\(err(or)?\)|err(or)?\.message/);
  }
  const workflow = read("lib/integrations/autohdr/workflow.ts");
  assert.match(workflow, /createProductionR2Storage/);
  assert.match(workflow, /\.head\(/);
  assert.match(workflow, /\.getVerified\(/);
  assert.match(workflow, /verifyCanonicalImageStream/);
  assert.ok(workflow.indexOf(".head(") < workflow.indexOf(".getVerified("));
  assert.ok(workflow.indexOf(".getVerified(") < workflow.indexOf("acceptSourceUpload("));
  assert.doesNotMatch(read("lib/integrations/autohdr/database-adapter.ts"), /uploadUrl|upload_url|presigned/i);
  const requestCore = read("lib/integrations/autohdr/request-core.ts");
  assert.match(requestCore, /requestId/);
  assert.match(requestCore, /UUID\.test\(row\.requestId\)/);
  assert.doesNotMatch(workflow, /randomUUID/);
  assert.match(workflow, /requestId:\s*input\.requestId/);
  assert.doesNotMatch(workflow, /if \(!prepared\.newlyCreated\)[\s\S]{0,300}source_request_conflict/);
});

test("R2 presigning fixes browser-supplied headers and does not sign an empty SDK checksum", () => {
  const signer = read("lib/integrations/autohdr/source-upload.ts");
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.dependencies["@aws-sdk/s3-request-presigner"], "3.1065.0");
  assert.match(signer, /requestChecksumCalculation:\s*"WHEN_REQUIRED"/);
  assert.match(signer, /signableHeaders:\s*new Set\(\["content-type", "if-none-match", "x-amz-meta-sha256"\]\)/);
  assert.match(signer, /unhoistableHeaders:\s*new Set\(\["if-none-match", "x-amz-meta-sha256"\]\)/);
  assert.match(signer, /"content-length"/);
  assert.doesNotMatch(signer, /ACL:|x-amz-acl/);
});

test("database boundary centralizes the separately-owned RPC names and never stores URLs", () => {
  const adapter = read("lib/integrations/autohdr/database-adapter.ts");
  const contract = read("lib/integrations/autohdr/database-contract.ts");
  for (const rpc of [
    "create_autohdr_source_batch",
    "accept_autohdr_source_version",
    "claim_autohdr_job",
    "transition_autohdr_job",
    "assign_autohdr_provider_uid",
    "claim_autohdr_retrieval",
  ]) {
    assert.match(contract, new RegExp(rpc));
  }
  assert.match(adapter, /AUTOHDR_DATABASE_CONTRACT/);
  assert.doesNotMatch(adapter, /upload_url|processed_url|uploaded_files/);
  assert.doesNotMatch(adapter, /newly_claimed/);
  assert.match(adapter, /newly_created/);
  assert.doesNotMatch(adapter, /claim_outcome/);
  assert.match(read("lib/integrations/autohdr/workflow.ts"), /presignCanonicalAutoHDRSources/);
  for (const exactArgument of [
    "p_property_id",
    "p_manifest_sha256",
    "p_files",
    "p_expected_state",
    "p_new_state",
    "p_provider_status",
    "p_retrieval_claim_token",
  ]) {
    assert.match(contract, new RegExp(exactArgument));
  }
  for (const obsoleteArgument of [
    "p_file_manifest",
    "p_style",
    "p_from_state",
    "p_to_state",
    "p_claimed_by",
  ]) {
    assert.doesNotMatch(contract, new RegExp(`${obsoleteArgument}: input`));
  }
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

test("the mandatory provider upload callback is bounded, advisory, and cannot mutate state", () => {
  const callbackPath = "app/api/integrations/autohdr/upload/route.ts";
  assert.equal(existsSync(new URL(callbackPath, root)), true, "missing AutoHDR upload callback route");
  const callback = read(callbackPath);
  assert.match(callback, /MAX_CALLBACK_BYTES/);
  assert.match(callback, /status:\s*204/);
  assert.doesNotMatch(callback, /getServiceSupabase|createAutoHDRJobStore|\.rpc\(|\.from\(/);
  assert.doesNotMatch(callback, /console\.|request\.json\(|String\(error\)|error\.message/);
  assert.match(read("lib/integrations/autohdr/workflow.ts"), /api\/integrations\/autohdr\/upload/);
});

test("MediaWorkflow swaps gated prose for the compact runtime-gated AutoHDR UI", () => {
  const mediaWorkflow = read("app/admin/bookings/[id]/MediaWorkflow.tsx");
  const section = read("app/admin/bookings/[id]/AutoHDRSection.tsx");
  const page = read("app/admin/bookings/[id]/page.tsx");
  const readiness = read("lib/integrations/autohdr/readiness.ts");
  assert.match(mediaWorkflow, /\{autoHDR\}/);
  assert.doesNotMatch(mediaWorkflow, /autoHDRReadiness\.ready \? autoHDR/);
  assert.match(mediaWorkflow, /Prerequisite/);
  assert.doesNotMatch(mediaWorkflow, /presigned-upload contract, zero-credit test mode/);
  assert.match(page, /getAutoHDRRuntimeReadiness/);
  assert.match(page, /autoHDREnabled\s*\?\s*listBookingAutoHDRJobs/);
  assert.match(page, /mutationEnabled=\{autoHDRReadiness\.ready\}/);
  assert.match(readiness, /createProductionR2Storage/);
  assert.match(readiness, /MEDIA_R2_BROWSER_UPLOADS_ENABLED/);
  assert.match(readiness, /AUTOHDR_QUARANTINE_WORKFLOW_ENABLED/);
  assert.match(readiness, /===\s*"true"/);
  assert.match(section, /Review pending ingestion/);
  assert.match(section, /mutationEnabled/);
  assert.match(section, /disabled=\{!mutationEnabled \|\| busy/);
  assert.match(section, /hashAutoHDRSourceFiles/);
  assert.match(section, /crypto\.randomUUID\(\)/);
  assert.match(section, /requestId/);
  assert.match(section, /uploadCanonicalAutoHDRSources/);
  assert.match(section, /source\/prepare/);
  assert.match(section, /source\/accept/);
  assert.ok(section.indexOf("source/accept") < section.indexOf("autohdr/prepare"));
  assert.doesNotMatch(section, /Uploading directly to AutoHDR/);
  assert.doesNotMatch(section, /ready for delivery/i);
  assert.doesNotMatch(section, /iGUIDE/i);
  assert.match(section, /accept=\{ACCEPTED_FILES\}/);
  assert.doesNotMatch(section, /\.dng|\.raw|image\/\*/i);
});

test("retrieval documents the exact safe streaming prerequisite instead of buffering", () => {
  const prerequisite = read("lib/integrations/autohdr/retrieval-prerequisite.ts");
  assert.match(prerequisite, /DNS-pinned/);
  assert.match(prerequisite, /expected SHA-256/);
  assert.match(prerequisite, /createProductionR2Storage/);
  assert.doesNotMatch(prerequisite, /arrayBuffer\(|Buffer\.from\(/);
});
