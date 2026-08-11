import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";

import {
  buildDeterministicZip,
  createSyntheticSource,
  deriveDeliveryProfiles,
  mediaObjectKeys,
  sha256Hex,
  writeDeterministicZip,
} from "../src/pipeline.mjs";

const RELEASE = {
  releaseId: "55555555-5555-4555-8555-555555555555",
  profile: "client.fullres.share.v1",
};

function collector() {
  const chunks = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { destination, bytes: () => Buffer.concat(chunks) };
}

test("synthetic source produces deterministic full-res and provisional Ontario derivatives", async () => {
  const source = await createSyntheticSource({ width: 3000, height: 2000, seed: 7 });
  const first = await deriveDeliveryProfiles(source);
  const second = await deriveDeliveryProfiles(source);

  assert.equal(first.masterSha256, sha256Hex(source));
  assert.equal(first.fullRes.profile, "client.fullres.share.v1");
  assert.equal(first.fullRes.width, 3000);
  assert.equal(first.fullRes.height, 2000);
  assert.equal(first.mls.profile, "ontario.proptx.provisional.2026-08-11.v1");
  assert.equal(first.mls.width, 2048);
  assert.equal(first.mls.height, 1365);
  assert.equal(first.fullRes.sha256, second.fullRes.sha256);
  assert.equal(first.mls.sha256, second.mls.sha256);
  assert.deepEqual(first.fullRes.bytes, second.fullRes.bytes);
  assert.deepEqual(first.mls.bytes, second.mls.bytes);
});

test("object keys are immutable tenant-qualified paths and reject unsafe identifiers", () => {
  const ids = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    ingestJobId: "22222222-2222-4222-8222-222222222222",
    assetId: "33333333-3333-4333-8333-333333333333",
    versionId: "44444444-4444-4444-8444-444444444444",
    releaseId: RELEASE.releaseId,
  };
  const hash = "a".repeat(64);
  const keys = mediaObjectKeys(ids, hash);

  assert.ok(Object.isFrozen(keys));
  assert.deepEqual(Reflect.ownKeys(keys), ["quarantine", "master", "derivative", "package"]);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(keys))) {
    assert.ok("value" in descriptor, "key outputs must be data properties");
  }
  assert.equal(keys.master, `masters/${ids.organizationId}/${ids.assetId}/${ids.versionId}/${hash}.jpg`);
  assert.equal(keys.derivative("profile.v1"), `derivatives/${ids.organizationId}/${ids.versionId}/profile.v1/${hash}.jpg`);
  assert.equal(keys.package("full_res", hash), `packages/${ids.organizationId}/${ids.releaseId}/full_res/${hash}.zip`);
  const coerciveString = { toString: () => "profile.v1" };
  assert.throws(() => keys.derivative(coerciveString), /primitive string/);
  assert.throws(() => keys.package(coerciveString, hash), /primitive string/);
  assert.throws(() => keys.package("full_res", { toString: () => hash }), /primitive string/);
  assert.throws(() => mediaObjectKeys({ ...ids, organizationId: "../other-tenant" }, hash), /organizationId/);
  for (const required of Object.keys(ids)) {
    const incomplete = { ...ids };
    delete incomplete[required];
    assert.throws(() => mediaObjectKeys(incomplete, hash), new RegExp(required));
    assert.throws(() => mediaObjectKeys({ ...ids, [required]: undefined }, hash), /primitive string/);
    assert.throws(() => mediaObjectKeys({ ...ids, [required]: null }, hash), /primitive string/);
    let coercions = 0;
    const coercive = {
      toString() {
        coercions += 1;
        return coercions === 1 ? ids[required] : "../other-tenant";
      },
    };
    assert.throws(() => mediaObjectKeys({ ...ids, [required]: coercive }, hash), /primitive string/);
  }
  assert.throws(() => mediaObjectKeys({ ...ids, unexpectedId: ids.assetId }, hash), /unexpected identifier/);
  const nonEnumerable = { ...ids };
  Object.defineProperty(nonEnumerable, "hiddenId", { value: ids.assetId, enumerable: false });
  assert.throws(() => mediaObjectKeys(nonEnumerable, hash), /unexpected identifier/);
  assert.throws(() => mediaObjectKeys({ ...ids, [Symbol("hidden")]: ids.assetId }, hash), /unexpected identifier/);
  const accessor = { ...ids };
  Object.defineProperty(accessor, "organizationId", { get: () => ids.organizationId, enumerable: true });
  assert.throws(() => mediaObjectKeys(accessor, hash), /data property/);
  const proxied = new Proxy({ ...ids, hiddenId: ids.assetId }, {
    ownKeys: () => Object.keys(ids),
    getOwnPropertyDescriptor: (target, property) => Object.getOwnPropertyDescriptor(target, property),
  });
  assert.throws(() => mediaObjectKeys(proxied, hash), /Proxy/);
  assert.throws(() => mediaObjectKeys(ids, { toString: () => hash }), /primitive string/);
  assert.throws(() => mediaObjectKeys(ids, "not-a-hash"), /sha256/);
});

test("ZIP inputs require exact data records and snapshot buffered bytes", async () => {
  const bytes = Buffer.from("original-synthetic-bytes");
  const releaseAccessor = {};
  Object.defineProperty(releaseAccessor, "releaseId", { value: RELEASE.releaseId, enumerable: true });
  Object.defineProperty(releaseAccessor, "profile", { get: () => RELEASE.profile, enumerable: true });
  await assert.rejects(buildDeterministicZip([{ name: "photo.jpg", bytes }], releaseAccessor), /data property/);

  const releaseExtra = { ...RELEASE };
  Object.defineProperty(releaseExtra, "hidden", { value: "extra", enumerable: false });
  await assert.rejects(buildDeterministicZip([{ name: "photo.jpg", bytes }], releaseExtra), /unexpected release metadata/);
  await assert.rejects(
    buildDeterministicZip([{ name: "photo.jpg", bytes }], { ...RELEASE, [Symbol("extra")]: true }),
    /unexpected release metadata/,
  );
  await assert.rejects(
    buildDeterministicZip([{ name: "photo.jpg", bytes }], new Proxy({ ...RELEASE }, {})),
    /Proxy/,
  );

  const fileAccessor = { name: "photo.jpg" };
  Object.defineProperty(fileAccessor, "bytes", { get: () => bytes, enumerable: true });
  await assert.rejects(buildDeterministicZip([fileAccessor], RELEASE), /data property/);
  await assert.rejects(
    buildDeterministicZip([{ name: "photo.jpg", bytes, [Symbol("extra")]: true }], RELEASE),
    /unexpected archive entry property/,
  );
  await assert.rejects(
    buildDeterministicZip([new Proxy({ name: "photo.jpg", bytes }, {})], RELEASE),
    /Proxy/,
  );

  const expected = Buffer.from(bytes);
  const pending = buildDeterministicZip([{ name: "photo.jpg", bytes }], RELEASE);
  bytes.fill(0);
  const snapshotted = await pending;
  const baseline = await buildDeterministicZip([{ name: "photo.jpg", bytes: expected }], RELEASE);
  assert.deepEqual(snapshotted.bytes, baseline.bytes);
  assert.equal(snapshotted.manifest.files[0].sha256, sha256Hex(expected));
});

test("ZIP packages derive a truthful manifest from exact archive inputs", async () => {
  const sourceA = await createSyntheticSource({ width: 640, height: 480, seed: 1 });
  const sourceB = await createSyntheticSource({ width: 640, height: 480, seed: 2 });
  const files = [
    { name: "02-kitchen.jpg", bytes: sourceB },
    { name: "01-front-exterior.jpg", bytes: sourceA },
  ];

  const first = await buildDeterministicZip(files, RELEASE);
  const second = await buildDeterministicZip([...files].reverse(), RELEASE);

  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.fileCount, 3);
  assert.deepEqual(first.manifest.files, [
    { name: "01-front-exterior.jpg", bytes: sourceA.length, sha256: sha256Hex(sourceA) },
    { name: "02-kitchen.jpg", bytes: sourceB.length, sha256: sha256Hex(sourceB) },
  ]);
  assert.ok(first.bytes.includes(Buffer.from("release-manifest.json")));
});

test("ZIP packages reserve unsafe filenames and reject independent file claims", async () => {
  const bytes = Buffer.from("synthetic");
  await assert.rejects(
    buildDeterministicZip([{ name: "release-manifest.json", bytes }], RELEASE),
    /reserved/i,
  );
  await assert.rejects(
    buildDeterministicZip([{ name: "Photo.JPG", bytes }, { name: "photo.jpg", bytes }], RELEASE),
    /duplicate/i,
  );
  for (const name of ["Ｐhoto.jpg", "Οσ.jpg", "Ος.jpg", "Straße.jpg"]) {
    await assert.rejects(
      buildDeterministicZip([{ name, bytes }], RELEASE),
      /portable ASCII/i,
    );
  }
  for (const name of ["photo\nname.jpg", "photo\u007fname.jpg", "photo\u0085name.jpg", "photo\u009bname.jpg"]) {
    await assert.rejects(
      buildDeterministicZip([{ name, bytes }], RELEASE),
      /control character/i,
    );
  }
  for (const name of ["photo.jpg ", "photo.jpg."]) {
    await assert.rejects(
      buildDeterministicZip([{ name, bytes }], RELEASE),
      /space or dot/i,
    );
  }
  await assert.rejects(
    buildDeterministicZip([{ name: "photo.jpg", bytes }], { ...RELEASE, files: [] }),
    /release metadata/i,
  );
});

test("ZIP packages can stream to object storage without buffering the archive", async () => {
  const source = await createSyntheticSource({ width: 320, height: 240, seed: 9 });
  const files = [
    { name: "01-front.jpg", bytes: source },
    { name: "02-rear.jpg", bytes: source },
  ];
  const collected = collector();

  const streamed = await writeDeterministicZip(files, RELEASE, collected.destination);
  const buffered = await buildDeterministicZip(files, RELEASE);

  assert.deepEqual(collected.bytes(), buffered.bytes);
  assert.equal(streamed.sha256, buffered.sha256);
  assert.equal(streamed.bytesWritten, buffered.bytes.length);
  assert.equal(streamed.fileCount, 3);
});

test("stream-backed entries verify declared byte length and checksum", async () => {
  const source = await createSyntheticSource({ width: 320, height: 240, seed: 11 });
  const run = async () => {
    const collected = collector();
    const result = await writeDeterministicZip(
      [{
        name: "01-front.jpg",
        source: () => Readable.from(source),
        bytesLength: source.length,
        sha256: sha256Hex(source),
      }],
      RELEASE,
      collected.destination,
    );
    return { ...result, bytes: collected.bytes() };
  };

  const first = await run();
  const second = await run();
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.sha256, second.sha256);

  const bad = collector();
  await assert.rejects(
    writeDeterministicZip(
      [{ name: "01-front.jpg", source: () => Readable.from(source), bytesLength: source.length, sha256: "0".repeat(64) }],
      RELEASE,
      bad.destination,
    ),
    /checksum mismatch/,
  );
  assert.equal(bad.destination.destroyed, true);
});

test("ZIP failures destroy archive destinations instead of leaving partial streams open", async () => {
  const collected = collector();
  await assert.rejects(
    writeDeterministicZip(
      [{ name: "01-front.jpg", source: () => { throw new Error("synthetic source failure"); }, bytesLength: 10, sha256: "a".repeat(64) }],
      RELEASE,
      collected.destination,
    ),
    /synthetic source failure/,
  );
  assert.equal(collected.destination.destroyed, true);

  const destination = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("synthetic destination failure"));
    },
  });
  await assert.rejects(
    writeDeterministicZip([{ name: "01-front.jpg", bytes: Buffer.from("photo") }], RELEASE, destination),
    /synthetic destination failure/,
  );
  assert.equal(destination.destroyed, true);
});

test("ZIP packaging enforces bounded entries and aggregate declared bytes", async () => {
  const bytes = Buffer.from("x");
  const tooMany = Array.from({ length: 501 }, (_, index) => ({ name: `${index}.jpg`, bytes }));
  await assert.rejects(buildDeterministicZip(tooMany, RELEASE), /500 entries/);
  const oversizedBuffer = Buffer.alloc(100 * 1024 * 1024 + 1);
  await assert.rejects(
    writeDeterministicZip([{ name: "oversized.jpg", bytes: oversizedBuffer }], RELEASE, collector().destination),
    /declared bytes.*100 MiB/,
  );
  const sixtyMiB = Buffer.alloc(60 * 1024 * 1024);
  await assert.rejects(
    buildDeterministicZip([
      { name: "sixty-a.jpg", bytes: sixtyMiB },
      { name: "sixty-b.jpg", bytes: sixtyMiB },
    ], RELEASE),
    /buffered ZIP input exceeds 100 MiB/,
  );
  const tooLarge = Array.from({ length: 205 }, (_, index) => ({
    name: `huge-${index}.jpg`,
    source: () => Readable.from(bytes),
    bytesLength: 100 * 1024 * 1024,
    sha256: sha256Hex(bytes),
  }));
  await assert.rejects(
    writeDeterministicZip(tooLarge, RELEASE, collector().destination),
    /aggregate bytes/,
  );
});
