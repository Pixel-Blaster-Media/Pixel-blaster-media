import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAutoHDRTransition,
  buildAutoHDRIdempotencyKey,
  normalizeAutoHDRFileManifest,
  normalizeAutoHDRSourceManifest,
} from "../lib/integrations/autohdr/workflow-core.ts";

test("builds a stable tenant and booking-bound idempotency key", () => {
  const manifest = normalizeAutoHDRFileManifest([
    { name: "Kitchen.JPG", size: 1024, lastModified: 100 },
    { name: "Front.jpg", size: 2048, lastModified: 200 },
  ]);
  const first = buildAutoHDRIdempotencyKey({
    organizationId: "11111111-1111-4111-8111-111111111111",
    bookingId: "22222222-2222-4222-8222-222222222222",
    manifest,
  });
  const second = buildAutoHDRIdempotencyKey({
    organizationId: "11111111-1111-4111-8111-111111111111",
    bookingId: "22222222-2222-4222-8222-222222222222",
    manifest,
  });
  assert.equal(first, second);
  assert.match(first, /^autohdr:22222222-2222-4222-8222-222222222222:[a-f0-9]{64}$/);
});

test("rejects duplicate, unsafe, empty, and oversized file manifests", () => {
  assert.throws(() => normalizeAutoHDRFileManifest([]), /at least one/i);
  assert.throws(
    () => normalizeAutoHDRFileManifest([{ name: "../photo.jpg", size: 1, lastModified: 1 }]),
    /filename/i,
  );
  assert.throws(
    () =>
      normalizeAutoHDRFileManifest([
        { name: "photo.jpg", size: 1, lastModified: 1 },
        { name: "photo.jpg", size: 1, lastModified: 1 },
      ]),
    /duplicate/i,
  );
  assert.throws(
    () => normalizeAutoHDRFileManifest([{ name: "photo.jpg", size: 26 * 1024 * 1024, lastModified: 1 }]),
    /25 MiB/i,
  );
  assert.throws(
    () => normalizeAutoHDRFileManifest([{ name: "photo.jpg", size: "1024", lastModified: 1 }]),
    /25 MiB/i,
  );
  assert.throws(
    () => normalizeAutoHDRFileManifest(Array.from({ length: 21 }, (_, index) => ({
      name: `${index}.jpg`, size: 1, lastModified: 1,
    }))),
    /20 images/i,
  );
  assert.throws(
    () => normalizeAutoHDRFileManifest(Array.from({ length: 11 }, (_, index) => ({
      name: `${index}.jpg`, size: 25 * 1024 * 1024, lastModified: 1,
    }))),
    /250 MiB/i,
  );
  assert.throws(
    () => normalizeAutoHDRFileManifest([{ name: "photo.jpg", size: 1024, lastModified: "1" }]),
    /timestamp/i,
  );
});

test("preserves the browser filename exactly", () => {
  const [entry] = normalizeAutoHDRFileManifest([
    { name: " Kitchen Final.CR3 ", size: 1024, lastModified: 1 },
  ]);
  assert.equal(entry.name, " Kitchen Final.CR3 ");
});

test("canonical source manifests enforce the same first-release count, file, and total bounds", () => {
  const source = (position, byteSize = 1) => ({
    position,
    filename: `${position}.jpg`,
    byteSize,
    lastModified: 1,
    contentType: "image/jpeg",
    sha256: position.toString(16).padStart(64, "0"),
  });
  assert.throws(
    () => normalizeAutoHDRSourceManifest(Array.from({ length: 21 }, (_, index) => source(index))),
    /20 images/i,
  );
  assert.throws(
    () => normalizeAutoHDRSourceManifest([source(0, 25 * 1024 * 1024 + 1)]),
    /byte size/i,
  );
  assert.throws(
    () => normalizeAutoHDRSourceManifest(Array.from(
      { length: 11 },
      (_, index) => source(index, 25 * 1024 * 1024),
    )),
    /250 MiB/i,
  );
});

test("allows only the fail-closed AutoHDR job transitions", () => {
  assert.doesNotThrow(() => assertAutoHDRTransition("claimed", "preparing"));
  assert.doesNotThrow(() => assertAutoHDRTransition("preparing", "awaiting_upload"));
  assert.doesNotThrow(() => assertAutoHDRTransition("awaiting_upload", "finalizing"));
  assert.doesNotThrow(() => assertAutoHDRTransition("finalizing", "processing"));
  assert.doesNotThrow(() => assertAutoHDRTransition("processing", "ready"));
  assert.doesNotThrow(() => assertAutoHDRTransition("ready", "retrieving"));
  assert.doesNotThrow(() => assertAutoHDRTransition("retrieving", "review_pending"));
  assert.throws(() => assertAutoHDRTransition("preparing", "claimed"), /invalid transition/i);
  assert.throws(() => assertAutoHDRTransition("ready", "review_pending"), /invalid transition/i);
  assert.throws(() => assertAutoHDRTransition("review_pending", "retrieving"), /invalid transition/i);
});
