import assert from "node:assert/strict";
import test from "node:test";

import { uploadAutoHDRFiles } from "../lib/integrations/autohdr/browser-upload.ts";

test("browser uploads directly with exact signed headers, bounded concurrency, and no body read", async () => {
  const files = Array.from({ length: 9 }, (_, index) => ({
    name: `photo-${index}.cr3`,
    size: index + 1,
    lastModified: index,
  }));
  const uploads = files.map((file) => ({
    filename: file.name,
    url: `https://image-upload-autohdr-j.s3.amazonaws.com/${file.name}?signed=opaque`,
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-amz-acl": "private",
    },
  }));
  let active = 0;
  let maximum = 0;
  let bodyReads = 0;
  const seen = [];

  await uploadAutoHDRFiles(files, uploads, {
    concurrency: 3,
    fetchImpl: async (url, init) => {
      active += 1;
      maximum = Math.max(maximum, active);
      seen.push({ url, init });
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return {
        ok: true,
        status: 200,
        text() {
          bodyReads += 1;
          return Promise.resolve("sensitive signed upload response");
        },
      };
    },
  });

  assert.equal(maximum, 3);
  assert.equal(bodyReads, 0);
  assert.equal(seen.length, files.length);
  assert.deepEqual(seen[0].init.headers, {
    "Content-Type": "application/octet-stream",
    "x-amz-acl": "private",
  });
  assert.equal(seen[0].init.redirect, "error");
  assert.equal(seen[0].init.body, files[0]);
});

test("browser refuses mismatched manifests and does not expose failed response bodies", async () => {
  let bodyReads = 0;
  await assert.rejects(
    uploadAutoHDRFiles(
      [{ name: "a.cr3", size: 1, lastModified: 1 }],
      [{
        filename: "different.cr3",
        url: "https://image-upload-autohdr-j.s3.amazonaws.com/a?opaque",
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-amz-acl": "private",
        },
      }],
      {
        fetchImpl: async () => ({
          ok: false,
          status: 403,
          text() {
            bodyReads += 1;
            return Promise.resolve("secret response");
          },
        }),
      },
    ),
    /match/i,
  );
  assert.equal(bodyReads, 0);
});
