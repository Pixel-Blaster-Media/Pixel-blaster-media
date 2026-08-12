import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoHDRCreateRequest,
  normalizeAutoHDRStatus,
  parseAutoHDRCreateResponse,
  parseAutoHDRProcessedPhotos,
  parseAutoHDRStatusResponse,
} from "../lib/integrations/autohdr/contract.ts";

test("AutoHDR create requests use documented defaults and bounded filenames", () => {
  assert.deepEqual(
    buildAutoHDRCreateRequest({
      files: ["DSC_0001.CR3", "DSC_0002.CR3"],
      uploadCallbackUrl: "https://pixelblastermedia.com/api/integrations/autohdr/upload",
      style: { modelSelection: "Classic-V4", perspectiveCorrection: true },
      mockCall: true,
    }),
    {
      files: [{ filename: "DSC_0001.CR3" }, { filename: "DSC_0002.CR3" }],
      upload_callback_url:
        "https://pixelblastermedia.com/api/integrations/autohdr/upload",
      mock_call: true,
      style: {
        model_selection: "Classic-V4",
        perspective_correction: true,
      },
    },
  );
  assert.throws(
    () =>
      buildAutoHDRCreateRequest({
        files: ["../secret.jpg"],
        uploadCallbackUrl: "https://pixelblastermedia.com/callback",
      }),
    /filename/i,
  );
});

test("AutoHDR create responses keep undocumented uploaded_files values opaque", () => {
  assert.deepEqual(
    parseAutoHDRCreateResponse({
      id: 42,
      uid: "shoot_abc-123",
      uploaded_files: ["https://uploads.example/one"],
      status: "created",
      creation_date_utc: "2026-08-12T20:00:00Z",
    }),
    {
      id: 42,
      uid: "shoot_abc-123",
      uploadedFiles: ["https://uploads.example/one"],
      status: "created",
      createdAt: "2026-08-12T20:00:00Z",
    },
  );
  assert.throws(
    () =>
      parseAutoHDRCreateResponse({
        id: 42,
        uid: "",
        uploaded_files: [],
        status: "created",
        creation_date_utc: "2026-08-12T20:00:00Z",
      }),
    /uid/i,
  );
  assert.equal(
    parseAutoHDRCreateResponse({
      id: 42,
      uid: "shoot_abc-123",
      uploaded_files: ["provider-object-key-not-a-documented-url"],
      status: "created",
      creation_date_utc: "2026-08-12T20:00:00Z",
    }).uploadedFiles[0],
    "provider-object-key-not-a-documented-url",
  );
});

test("AutoHDR status keeps the raw provider state and normalizes conservatively", () => {
  assert.equal(normalizeAutoHDRStatus("completed"), "ready");
  assert.equal(normalizeAutoHDRStatus("processing"), "processing");
  assert.equal(normalizeAutoHDRStatus("totally_new_state"), "unknown");
  assert.deepEqual(
    parseAutoHDRStatusResponse({
      id: 42,
      status: "totally_new_state",
      creation_date_utc: "2026-08-12T20:00:00Z",
    }),
    {
      id: 42,
      rawStatus: "totally_new_state",
      normalizedStatus: "unknown",
      createdAt: "2026-08-12T20:00:00Z",
    },
  );
});

test("processed photos preserve names but accept only bounded HTTPS URLs", () => {
  assert.deepEqual(
    parseAutoHDRProcessedPhotos({
      files: [
        { name: "Kitchen.jpg", url: "https://cdn.example/kitchen.jpg?token=x" },
      ],
    }),
    [{ name: "Kitchen.jpg", url: "https://cdn.example/kitchen.jpg?token=x" }],
  );
  for (const url of [
    "http://cdn.example/kitchen.jpg",
    "https://user:pass@cdn.example/kitchen.jpg",
    "https://localhost/kitchen.jpg",
  ]) {
    assert.throws(
      () => parseAutoHDRProcessedPhotos({ files: [{ name: "Kitchen.jpg", url }] }),
      /URL/i,
    );
  }
});
