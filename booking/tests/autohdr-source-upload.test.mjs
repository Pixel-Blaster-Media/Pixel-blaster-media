import assert from "node:assert/strict";
import test from "node:test";

import {
  hashAutoHDRSourceFiles,
  uploadCanonicalAutoHDRSources,
} from "../lib/integrations/autohdr/browser-upload.ts";
import {
  buildCanonicalSourcePutInput,
  isCanonicalBrowserUploadEnabled,
  validateCanonicalSourceUpload,
} from "../lib/integrations/autohdr/source-upload-core.ts";
import { verifyCanonicalImageStream } from "../lib/integrations/autohdr/source-image-verification.ts";

const ids = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  mediaBatchId: "22222222-2222-4222-8222-222222222222",
  mediaAssetId: "33333333-3333-4333-8333-333333333333",
  sourceMediaVersionId: "44444444-4444-4444-8444-444444444444",
};

function browserFile(name, bytes, type = "image/jpeg", lastModified = 1234) {
  const body = Uint8Array.from(bytes);
  return {
    name,
    size: body.byteLength,
    lastModified,
    type,
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
  };
}

test("browser hashes the bounded selected set and sends stable manifest metadata", async () => {
  const manifest = await hashAutoHDRSourceFiles([
    browserFile("Kitchen.jpg", [1, 2, 3]),
    browserFile("Exterior.png", [4, 5], "image/png"),
  ]);
  assert.deepEqual(manifest, [
    {
      position: 0,
      filename: "Kitchen.jpg",
      byteSize: 3,
      lastModified: 1234,
      contentType: "image/jpeg",
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    },
    {
      position: 1,
      filename: "Exterior.png",
      byteSize: 2,
      lastModified: 1234,
      contentType: "image/png",
      sha256: "2fa1b377bf67309f65e5e7bc9d924345ca648dec4e601a398a9cb497dcba3765",
    },
  ]);
  await assert.rejects(
    hashAutoHDRSourceFiles(Array.from({ length: 161 }, (_, index) => browserFile(`${index}.jpg`, [1]))),
    /160/,
  );
  await assert.rejects(
    hashAutoHDRSourceFiles([{ ...browserFile("huge.jpg", [1]), size: 100 * 1024 * 1024 + 1 }]),
    /100 MiB/,
  );
});

test("browser rejects RAW, DNG, extension/MIME mismatches, and ambiguous image MIME before reading bytes", async () => {
  for (const file of [
    browserFile("Kitchen.dng", [1], "image/x-adobe-dng"),
    browserFile("Kitchen.raw", [1], "application/octet-stream"),
    browserFile("Kitchen.jpg", [1], "image/png"),
    browserFile("Kitchen.png", [1], "image/jpeg"),
    browserFile("Kitchen.jpeg", [1], ""),
  ]) {
    let reads = 0;
    await assert.rejects(
      hashAutoHDRSourceFiles([{ ...file, arrayBuffer: async () => { reads += 1; return new ArrayBuffer(1); } }]),
      /JPEG|PNG|type/i,
    );
    assert.equal(reads, 0);
  }
});

test("canonical master PUT fixes and signs content type plus checksum metadata without public access", () => {
  const sha256 = "ab".repeat(32);
  const input = buildCanonicalSourcePutInput({
    ...ids,
    objectKey: `masters/${ids.organizationId}/${ids.mediaAssetId}/${ids.sourceMediaVersionId}/${sha256}.jpg`,
    byteSize: 2048,
    contentType: "image/jpeg",
    sha256,
    bucket: "pixel-blaster-private-media",
  });
  assert.deepEqual(input, {
    Bucket: "pixel-blaster-private-media",
    Key: `masters/${ids.organizationId}/${ids.mediaAssetId}/${ids.sourceMediaVersionId}/${sha256}.jpg`,
    ContentLength: 2048,
    ContentType: "image/jpeg",
    Metadata: { sha256 },
    IfNoneMatch: "*",
  });
  assert.equal("ACL" in input, false);
  assert.equal(JSON.stringify(input).includes("secret"), false);
  assert.throws(
    () => buildCanonicalSourcePutInput({
      ...ids,
      objectKey: `masters/${ids.organizationId}/${ids.mediaAssetId}/${ids.sourceMediaVersionId}/${sha256}.jpg`,
      byteSize: 2048,
      contentType: "image/jpeg",
      sha256,
      bucket: "public-media",
    }),
    /private/i,
  );
});

test("browser uploads only exact canonical identities with signed fields and bounded concurrency", async () => {
  const file = browserFile("Kitchen.jpg", [1, 2, 3]);
  const sha256 = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
  const source = {
    position: 0,
    filename: file.name,
    byteSize: file.size,
    lastModified: file.lastModified,
    contentType: "image/jpeg",
    sha256,
    mediaBatchId: ids.mediaBatchId,
    mediaAssetId: ids.mediaAssetId,
    sourceMediaVersionId: ids.sourceMediaVersionId,
    objectKey: `masters/${ids.organizationId}/${ids.mediaAssetId}/${ids.sourceMediaVersionId}/${sha256}.jpg`,
    upload: {
      url: "https://pixel-blaster-private-media.example.invalid/object?X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match%3Bx-amz-meta-sha256",
      method: "PUT",
      headers: {
        "Content-Type": "image/jpeg",
        "If-None-Match": "*",
        "x-amz-meta-sha256": sha256,
      },
    },
  };
  const seen = [];
  await uploadCanonicalAutoHDRSources([file], [source], {
    concurrency: 2,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200 };
    },
  });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].init.headers, source.upload.headers);
  assert.equal(seen[0].init.body, file);
  await assert.rejects(
    uploadCanonicalAutoHDRSources([file], [{ ...source, sha256: "cd".repeat(32) }], {
      fetchImpl: async () => { throw new Error("must not upload"); },
    }),
    /match/i,
  );
  await assert.rejects(
    uploadCanonicalAutoHDRSources([file], [{
      ...source,
      upload: { ...source.upload, headers: { ...source.upload.headers, "X-Extra": "no" } },
    }], { fetchImpl: async () => { throw new Error("must not upload"); } }),
    /match/i,
  );
});

test("HEAD acceptance rejects any size, image MIME, checksum, extension, key, or identity mismatch", () => {
  const sha256 = "ab".repeat(32);
  const source = {
    ...ids,
    objectKey: `masters/${ids.organizationId}/${ids.mediaAssetId}/${ids.sourceMediaVersionId}/${sha256}.jpg`,
    byteSize: 2048,
    contentType: "image/jpeg",
    sha256,
  };
  assert.doesNotThrow(() => validateCanonicalSourceUpload(source, {
    bytes: 2048,
    contentType: "image/jpeg",
    sha256,
    etag: '"opaque"',
  }));
  for (const head of [
    { bytes: 2049, contentType: source.contentType, sha256, etag: '"opaque"' },
    { bytes: 2048, contentType: "image/png", sha256, etag: '"opaque"' },
    { bytes: 2048, contentType: source.contentType, sha256: "cd".repeat(32), etag: '"opaque"' },
  ]) {
    assert.throws(() => validateCanonicalSourceUpload(source, head), /match/i);
  }
  assert.throws(
    () => validateCanonicalSourceUpload({ ...source, objectKey: source.objectKey.replace(ids.mediaAssetId, ids.sourceMediaVersionId) }, {
      bytes: 2048, contentType: source.contentType, sha256, etag: '"opaque"',
    }),
    /identity|key/i,
  );
  assert.throws(
    () => validateCanonicalSourceUpload({ ...source, objectKey: source.objectKey.replace(/\.jpg$/, ".png") }, {
      bytes: 2048, contentType: source.contentType, sha256, etag: '"opaque"',
    }),
    /extension|content type/i,
  );
});

test("verified JPEG/PNG dimensions come from bounded server bytes and the verifying stream is fully drained", async () => {
  let jpegDrained = false;
  async function* jpegBody() {
    yield Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]);
    yield Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0x01, 0x11, 0x00]);
    jpegDrained = true;
    yield Buffer.from([0xff, 0xd9]);
  }
  assert.deepEqual(await verifyCanonicalImageStream(jpegBody(), "image/jpeg"), {
    widthPx: 1920,
    heightPx: 1080,
  });
  assert.equal(jpegDrained, true);

  async function* pngBody() {
    yield Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x0b, 0xb8, 0x00, 0x00, 0x07, 0xd0,
    ]);
  }
  assert.deepEqual(await verifyCanonicalImageStream(pngBody(), "image/png"), {
    widthPx: 3000,
    heightPx: 2000,
  });
  await assert.rejects(
    verifyCanonicalImageStream((async function* () {
      yield Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      throw new Error("download checksum mismatch");
    })(), "image/png"),
    /checksum/,
  );
});

test("server image policy rejects malformed, oversized-dimension, and excessive-pixel sources", async () => {
  const png = (width, height) => (async function* () {
    const header = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    yield header;
  })();
  await assert.rejects(verifyCanonicalImageStream(png(0, 100), "image/png"), /dimensions/i);
  await assert.rejects(verifyCanonicalImageStream(png(40_000, 2), "image/png"), /dimensions/i);
  await assert.rejects(verifyCanonicalImageStream(png(20_000, 20_000), "image/png"), /pixels/i);
  await assert.rejects(
    verifyCanonicalImageStream((async function* () { yield Buffer.from("not a jpeg"); })(), "image/jpeg"),
    /JPEG/i,
  );
});

test("production browser uploads require the explicit exact acknowledgement", () => {
  assert.equal(isCanonicalBrowserUploadEnabled({ MEDIA_R2_BROWSER_UPLOADS_ENABLED: "true" }), true);
  for (const value of [undefined, "false", "TRUE", " true", "true "]) {
    assert.equal(isCanonicalBrowserUploadEnabled({ MEDIA_R2_BROWSER_UPLOADS_ENABLED: value }), false);
  }
});
