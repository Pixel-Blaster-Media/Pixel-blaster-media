import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("media worker spike records deterministic transformations, streaming packages, and real benchmarks", () => {
  const report = read("spikes/media-worker/README.md");

  assert.match(report, /synthetic files only/i);
  assert.match(report, /50[\s\S]*358\.9 MiB/);
  assert.match(report, /100[\s\S]*377\.8 MiB/);
  assert.match(report, /200[\s\S]*407\.3 MiB/);
  assert.match(report, /unique synthetic source/i);
  assert.match(report, /persisted the unique full-resolution derivative to a temporary file/i);
  assert.match(report, /OS-reported high-water RSS/i);
  assert.match(report, /R2 credentials were not present/i);
  assert.match(report, /Docker was not installed/i);
  assert.match(report, /No production data, provider credit, or remote object was used/i);
});

test("Release 1 boundary is additive, disabled by default, and preserves every legacy workflow", () => {
  const boundary = read("docs/MEDIA_RELEASE_1_BOUNDARY.md");

  assert.match(boundary, /MEDIA_V1_ENABLED=false/);
  assert.match(boundary, /shadow mode/i);
  assert.match(boundary, /release-first, legacy-fallback/i);
  assert.match(boundary, /No table or column drop/i);
  assert.match(boundary, /No existing deliverable is deleted, rewritten, or invalidated/i);
  assert.match(boundary, /Autoenhance/i);
  assert.match(boundary, /iGUIDE/i);
  assert.match(boundary, /Cloudflare R2/i);
  assert.match(boundary, /Human gate/i);
  assert.match(boundary, /rollback/i);
});
