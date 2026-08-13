import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAutoHDRUploadDestination,
  pairAutoHDRUploadDestinations,
} from "../lib/integrations/autohdr/upload-contract.ts";

const signedUrl = ({
  contentType = "application/octet-stream",
  acl = "private",
  expires = "1786587239",
} = {}) =>
  `https://image-upload-autohdr-j.s3.amazonaws.com/org/raw/photo.jpg?` +
  new URLSearchParams({
    AWSAccessKeyId: "synthetic-access-key",
    Signature: "synthetic-signature",
    "content-type": contentType,
    "x-amz-acl": acl,
    Expires: expires,
  });

test("parses the exact signed AutoHDR S3 PUT requirements", () => {
  const parsed = parseAutoHDRUploadDestination(signedUrl());
  assert.deepEqual(parsed, {
    url: signedUrl(),
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-amz-acl": "private",
    },
  });
});

test("rejects an unexpected upload host or unsigned transport requirement", () => {
  assert.throws(
    () =>
      parseAutoHDRUploadDestination(
        signedUrl().replace("image-upload-autohdr-j.s3.amazonaws.com", "attacker.example"),
      ),
    /destination is not trusted/i,
  );
  assert.throws(
    () => parseAutoHDRUploadDestination(signedUrl({ contentType: "image/jpeg" })),
    /content type is unsupported/i,
  );
  assert.throws(
    () => parseAutoHDRUploadDestination(signedUrl({ acl: "public-read" })),
    /ACL is unsupported/i,
  );
});

test("pairs filenames and destinations only when counts match", () => {
  const uploads = pairAutoHDRUploadDestinations(
    ["kitchen.jpg", "front.jpg"],
    [signedUrl(), signedUrl().replace("photo.jpg", "front.jpg")],
  );
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].filename, "kitchen.jpg");
  assert.equal(uploads[1].filename, "front.jpg");
  assert.throws(
    () => pairAutoHDRUploadDestinations(["only.jpg"], [signedUrl(), signedUrl()]),
    /count did not match/i,
  );
});
