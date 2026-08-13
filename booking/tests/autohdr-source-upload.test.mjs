import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  hashAutoHDRSourceFiles,
  uploadCanonicalAutoHDRSources,
} from "../lib/integrations/autohdr/browser-upload.ts";
import {
  buildCanonicalSourcePutInput,
  buildQuarantineSourcePutInput,
  isCanonicalBrowserUploadEnabled,
  validateCanonicalSourceUpload,
} from "../lib/integrations/autohdr/source-upload-core.ts";
import { verifyCanonicalImageStream } from "../lib/integrations/autohdr/source-image-verification.ts";

const ids = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  mediaBatchId: "22222222-2222-4222-8222-222222222222",
  mediaAssetId: "33333333-3333-4333-8333-333333333333",
  sourceMediaVersionId: "44444444-4444-4444-8444-444444444444",
  ingestJobId: "55555555-5555-4555-8555-555555555555",
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

function streamBytes(bytes, chunkSize = bytes.length) {
  return (async function* () {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    }
  })();
}

function pngWithoutChunks(bytes, removedTypes) {
  const chunks = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!removedTypes.has(type)) chunks.push(bytes.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngWithDimensions(bytes, width, height) {
  const output = Buffer.from(bytes);
  assert.equal(output.toString("ascii", 12, 16), "IHDR");
  output.writeUInt32BE(width, 16);
  output.writeUInt32BE(height, 20);
  output.writeUInt32BE(crc32(output.subarray(12, 29)), 29);
  return output;
}

function jpegWithMalformedEntropy(bytes) {
  const startOfScan = bytes.indexOf(Buffer.from([0xff, 0xda]));
  assert.ok(startOfScan >= 0);
  const scanHeaderLength = bytes.readUInt16BE(startOfScan + 2);
  const entropyStart = startOfScan + 2 + scanHeaderLength;
  assert.ok(bytes.length - entropyStart > 8);
  return Buffer.concat([
    bytes.subarray(0, entropyStart + 2),
    Buffer.from([0xff, 0xd9]),
  ]);
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
    hashAutoHDRSourceFiles(Array.from({ length: 21 }, (_, index) => browserFile(`${index}.jpg`, [1]))),
    /20/,
  );
  await assert.rejects(
    hashAutoHDRSourceFiles([{ ...browserFile("huge.jpg", [1]), size: 25 * 1024 * 1024 + 1 }]),
    /25 MiB/,
  );
  await assert.rejects(
    hashAutoHDRSourceFiles(Array.from({ length: 11 }, (_, index) => ({
      ...browserFile(`${index}.jpg`, [1]),
      size: 25 * 1024 * 1024,
    }))),
    /250 MiB/,
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

test("browser PUT is create-only to the exact quarantine identity and never the master", () => {
  const sha256 = "ab".repeat(32);
  const quarantineObjectKey = `quarantine/${ids.organizationId}/${ids.ingestJobId}/66666666-6666-4666-8666-666666666666`;
  const objectKey = `masters/${ids.organizationId}/${ids.mediaAssetId}/${ids.sourceMediaVersionId}/${sha256}.jpg`;
  const input = buildQuarantineSourcePutInput({
    ...ids,
    quarantineObjectKey,
    objectKey,
    byteSize: 2048,
    contentType: "image/jpeg",
    sha256,
    bucket: "pixel-blaster-private-media",
  });
  assert.equal(input.Key, quarantineObjectKey);
  assert.equal(input.IfNoneMatch, "*");
  assert.equal(JSON.stringify(input).includes("masters/"), false);
  assert.throws(
    () => buildQuarantineSourcePutInput({ ...ids, quarantineObjectKey: objectKey, objectKey, byteSize: 2048, contentType: "image/jpeg", sha256, bucket: "pixel-blaster-private-media" }),
    /quarantine/i,
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
    ingestJobId: ids.ingestJobId,
    quarantineObjectKey: `quarantine/${ids.organizationId}/${ids.ingestJobId}/66666666-6666-4666-8666-666666666666`,
    objectKey: `masters/${ids.organizationId}/${ids.mediaAssetId}/${ids.sourceMediaVersionId}/${sha256}.jpg`,
    ingestState: "discovered",
    quarantineEtag: null,
    upload: {
      url: `https://pixel-blaster-private-media.example.invalid/quarantine/${ids.organizationId}/${ids.ingestJobId}/66666666-6666-4666-8666-666666666666?X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match%3Bx-amz-meta-sha256`,
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
  const replay = await uploadCanonicalAutoHDRSources([file], [source], {
    fetchImpl: async () => ({ ok: false, status: 412 }),
  });
  assert.equal(replay[0].status, "reconciliation_candidate");
  await assert.rejects(
    uploadCanonicalAutoHDRSources([file], [source], {
      fetchImpl: async () => ({ ok: false, status: 409 }),
    }),
    /unchanged files/i,
  );
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

test("terminal browser failure aborts in-flight siblings while ambiguous failures remain reconciliation candidates", async () => {
  const files = [0, 1, 2].map((index) => browserFile(`${index}.jpg`, [index + 1]));
  const sources = files.map((file, index) => {
    const digest = index.toString(16).padStart(2, "0").repeat(32);
    const version = `${index + 4}4444444-4444-4444-8444-444444444444`;
    const asset = `${index + 3}3333333-3333-4333-8333-333333333333`;
    const ingest = `${index + 5}5555555-5555-4555-8555-555555555555`;
    const quarantine = `quarantine/${ids.organizationId}/${ingest}/${index + 6}6666666-6666-4666-8666-666666666666`;
    return {
      position: index,
      filename: file.name,
      byteSize: file.size,
      lastModified: file.lastModified,
      contentType: "image/jpeg",
      sha256: digest,
      mediaBatchId: ids.mediaBatchId,
      mediaAssetId: asset,
      sourceMediaVersionId: version,
      ingestJobId: ingest,
      quarantineObjectKey: quarantine,
      objectKey: `masters/${ids.organizationId}/${asset}/${version}/${digest}.jpg`,
      ingestState: "discovered",
      quarantineEtag: null,
      upload: {
        url: `https://pixel-blaster-private-media.example.invalid/${quarantine}?X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost%3Bif-none-match%3Bx-amz-meta-sha256`,
        method: "PUT",
        headers: { "Content-Type": "image/jpeg", "If-None-Match": "*", "x-amz-meta-sha256": digest },
      },
    };
  });
  let siblingAborts = 0;
  await assert.rejects(
    uploadCanonicalAutoHDRSources(files, sources, {
      concurrency: 3,
      fetchImpl: async (_url, init) => {
        if (init.body === files[0]) return { ok: false, status: 403 };
        await new Promise((resolve) => {
          init.signal.addEventListener("abort", () => { siblingAborts += 1; resolve(); }, { once: true });
        });
        throw init.signal.reason;
      },
    }),
    (error) => error?.results?.[0]?.attempted === true,
  );
  assert.equal(siblingAborts, 2);

  const ambiguous = await uploadCanonicalAutoHDRSources([files[0]], [sources[0]], {
    perFileTimeoutMs: 5,
    operationTimeoutMs: 50,
    fetchImpl: async (_url, init) => {
      await new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      return { ok: true, status: 200 };
    },
  });
  assert.equal(ambiguous[0].status, "reconciliation_candidate");
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

test("full decoder accepts generated baseline/progressive JPEG and PNG after draining verified bytes", async () => {
  const raw = Buffer.alloc(17 * 11 * 3);
  for (let index = 0; index < raw.length; index += 1) raw[index] = (index * 37) % 256;
  const input = sharp(raw, { raw: { width: 17, height: 11, channels: 3 } });
  const [baseline, progressive, png] = await Promise.all([
    input.clone().jpeg({ progressive: false }).toBuffer(),
    input.clone().jpeg({ progressive: true }).toBuffer(),
    input.clone().png().toBuffer(),
  ]);
  for (const jpeg of [baseline, progressive]) {
    assert.deepEqual(await verifyCanonicalImageStream(streamBytes(jpeg, 7), "image/jpeg"), {
      widthPx: 17,
      heightPx: 11,
    });
  }
  assert.deepEqual(await verifyCanonicalImageStream(streamBytes(png, 5), "image/png"), {
    widthPx: 17,
    heightPx: 11,
  });
  await assert.rejects(
    verifyCanonicalImageStream((async function* () {
      yield Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      throw new Error("download checksum mismatch");
    })(), "image/png"),
    /checksum/,
  );
});

test("full decoder rejects structurally incomplete, corrupt, mismatched, and oversized images", async () => {
  const raw = Buffer.alloc(19 * 13 * 3);
  for (let index = 0; index < raw.length; index += 1) raw[index] = (index * 53) % 256;
  const [jpeg, png] = await Promise.all([
    sharp(raw, { raw: { width: 19, height: 13, channels: 3 } }).jpeg({ quality: 90 }).toBuffer(),
    sharp(raw, { raw: { width: 19, height: 13, channels: 3 } }).png().toBuffer(),
  ]);
  const ihdrOnly = png.subarray(0, 33);
  const missingIdat = pngWithoutChunks(png, new Set(["IDAT"]));
  const missingIend = pngWithoutChunks(png, new Set(["IEND"]));
  const badCrc = Buffer.from(png);
  badCrc[29] ^= 0xff;
  const sofOnlyJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);

  for (const invalidPng of [ihdrOnly, missingIdat, missingIend, badCrc]) {
    await assert.rejects(verifyCanonicalImageStream(streamBytes(invalidPng), "image/png"), /PNG|decode|valid/i);
  }
  for (const invalidJpeg of [sofOnlyJpeg, jpeg.subarray(0, -2), jpegWithMalformedEntropy(jpeg)]) {
    await assert.rejects(verifyCanonicalImageStream(streamBytes(invalidJpeg), "image/jpeg"), /JPEG|decode|valid/i);
  }
  await assert.rejects(verifyCanonicalImageStream(streamBytes(png), "image/jpeg"), /JPEG|type|format/i);
  await assert.rejects(verifyCanonicalImageStream(streamBytes(jpeg), "image/png"), /PNG|type|format/i);
  await assert.rejects(
    verifyCanonicalImageStream(streamBytes(pngWithDimensions(png, 40_000, 2)), "image/png"),
    /dimensions/i,
  );
  await assert.rejects(
    verifyCanonicalImageStream(streamBytes(pngWithDimensions(png, 20_000, 20_000)), "image/png"),
    /pixels/i,
  );
});

test("server verification rejects over-25-MiB streams and honors abort signals", async () => {
  const oneMiB = Buffer.alloc(1024 * 1024);
  await assert.rejects(
    verifyCanonicalImageStream((async function* () {
      for (let index = 0; index < 26; index += 1) yield oneMiB;
    })(), "image/jpeg"),
    /25 MiB/i,
  );
  const controller = new AbortController();
  controller.abort(new Error("source request deadline exceeded"));
  await assert.rejects(
    verifyCanonicalImageStream(streamBytes(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), "image/jpeg", controller.signal),
    /deadline exceeded/i,
  );
});

test("production browser uploads require the explicit exact acknowledgement", () => {
  assert.equal(isCanonicalBrowserUploadEnabled({
    MEDIA_R2_BROWSER_UPLOADS_ENABLED: "true",
    AUTOHDR_QUARANTINE_WORKFLOW_ENABLED: "true",
  }), true);
  assert.equal(isCanonicalBrowserUploadEnabled({ MEDIA_R2_BROWSER_UPLOADS_ENABLED: "true" }), false);
  assert.equal(isCanonicalBrowserUploadEnabled({ AUTOHDR_QUARANTINE_WORKFLOW_ENABLED: "true" }), false);
  for (const value of [undefined, "false", "TRUE", " true", "true "]) {
    assert.equal(isCanonicalBrowserUploadEnabled({
      MEDIA_R2_BROWSER_UPLOADS_ENABLED: value,
      AUTOHDR_QUARANTINE_WORKFLOW_ENABLED: "true",
    }), false);
  }
});
