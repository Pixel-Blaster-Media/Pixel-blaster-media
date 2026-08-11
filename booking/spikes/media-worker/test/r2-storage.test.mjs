import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";

import { R2Storage } from "../src/r2-storage.mjs";
import { sha256Hex } from "../src/pipeline.mjs";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

class FakeS3Client {
  constructor() {
    this.calls = [];
    this.objects = new Map();
  }

  async send(command) {
    this.calls.push({ name: command.constructor.name, input: command.input });
    const { Bucket, Key } = command.input;
    const identity = `${Bucket}/${Key}`;
    if (command.constructor.name === "PutObjectCommand") {
      if (this.putGate) await this.putGate;
      if (command.input.IfNoneMatch === "*" && this.objects.has(identity)) {
        const error = new Error("precondition failed");
        error.name = "PreconditionFailed";
        throw error;
      }
      this.objects.set(identity, {
        bytes: Buffer.from(command.input.Body),
        contentType: command.input.ContentType,
        metadata: command.input.Metadata,
      });
      return { ETag: '"synthetic-etag"' };
    }
    if (command.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(identity);
      if (!object) throw new Error("not found");
      return { ContentLength: object.bytes.length, ContentType: object.contentType, Metadata: object.metadata };
    }
    if (command.constructor.name === "GetObjectCommand") {
      const object = this.objects.get(identity);
      if (!object) throw new Error("not found");
      this.lastBody = this.bodyFactory ? this.bodyFactory(object.bytes) : Readable.from(object.bytes);
      return { Body: this.lastBody, ContentLength: object.bytes.length, Metadata: object.metadata };
    }
    throw new Error(`unexpected command ${command.constructor.name}`);
  }
}

async function consume(download) {
  const chunks = [];
  for await (const chunk of download.body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function storage(client = new FakeS3Client()) {
  return new R2Storage({ client, bucket: "pixel-media-spike", organizationId: ORGANIZATION_ID });
}

test("R2 storage binds every command to one tenant and checksum-addressed create-only keys", async () => {
  const client = new FakeS3Client();
  const store = storage(client);
  const bytes = Buffer.from("synthetic-media-only");
  const sha256 = sha256Hex(bytes);
  const key = `masters/${ORGANIZATION_ID}/asset/version/${sha256}.jpg`;

  const put = await store.putBuffer({ key, bytes, contentType: "image/jpeg", sha256 });
  const head = await store.head(key);
  const download = await store.getVerified(key);

  assert.equal(put.etag, '"synthetic-etag"');
  assert.equal(head.bytes, bytes.length);
  assert.equal(head.sha256, sha256);
  assert.deepEqual(await consume(download), bytes);
  assert.equal(client.calls[0].input.IfNoneMatch, "*");
  assert.deepEqual(client.calls.map((call) => call.name), ["PutObjectCommand", "HeadObjectCommand", "GetObjectCommand"]);

  await assert.rejects(store.putBuffer({ key, bytes, contentType: "image/jpeg", sha256 }), /already exists/i);
  assert.equal(typeof store.deleteExact, "undefined", "remote deletion stays unsupported until atomic R2 semantics are proven");
});

test("R2 uploads snapshot buffered bytes before asynchronous transport", async () => {
  const client = new FakeS3Client();
  let releasePut;
  client.putGate = new Promise((resolve) => { releasePut = resolve; });
  const store = storage(client);
  const bytes = Buffer.from("immutable-upload-snapshot");
  const expected = Buffer.from(bytes);
  const sha256 = sha256Hex(expected);
  const key = `masters/${ORGANIZATION_ID}/asset/version/${sha256}.jpg`;

  const pending = store.putBuffer({ key, bytes, contentType: "image/jpeg", sha256 });
  bytes.fill(0);
  releasePut();
  await pending;

  assert.deepEqual(client.objects.get(`pixel-media-spike/${key}`).bytes, expected);
});

test("R2 storage rejects cross-tenant, unsafe, non-addressed, and oversized writes", async () => {
  const store = storage();
  const bytes = Buffer.from("synthetic-media-only");
  const sha256 = sha256Hex(bytes);
  const key = `quarantine/${ORGANIZATION_ID}/job/version/${sha256}.bin`;

  await assert.rejects(
    store.putBuffer({ key: `masters/22222222-2222-4222-8222-222222222222/asset/version/${sha256}.jpg`, bytes, contentType: "image/jpeg", sha256 }),
    /organization prefix/,
  );
  await assert.rejects(
    store.putBuffer({ key: "../other-tenant/file.jpg", bytes, contentType: "image/jpeg", sha256 }),
    /unsafe object key/,
  );
  await assert.rejects(
    store.putBuffer({ key, bytes, contentType: "image/jpeg", sha256: "0".repeat(64) }),
    /checksum mismatch/,
  );
  await assert.rejects(
    store.putBuffer({ key: key.replace(sha256, "f".repeat(64)), bytes, contentType: "image/jpeg", sha256 }),
    /checksum-addressed/,
  );
  await assert.rejects(
    store.putBuffer({ key, bytes: Buffer.alloc(100 * 1024 * 1024 + 1), contentType: "image/jpeg", sha256 }),
    /100 MiB/,
  );
});

test("R2 downloads destroy response bodies rejected before streaming", async () => {
  const client = new FakeS3Client();
  const store = storage(client);
  const bytes = Buffer.from("synthetic-media-only");
  const sha256 = sha256Hex(bytes);
  const key = `masters/${ORGANIZATION_ID}/asset/version/${sha256}.jpg`;
  await store.putBuffer({ key, bytes, contentType: "image/jpeg", sha256 });

  client.objects.get(`pixel-media-spike/${key}`).metadata = {};
  await assert.rejects(store.getVerified(key), /checksum metadata/);
  assert.equal(client.lastBody.destroyed, true);
});

test("R2 verifier cancellation destroys the upstream response body", async () => {
  const client = new FakeS3Client();
  client.bodyFactory = () => new Readable({ read() {} });
  const store = storage(client);
  const bytes = Buffer.from("synthetic-media-only");
  const sha256 = sha256Hex(bytes);
  const key = `masters/${ORGANIZATION_ID}/asset/version/${sha256}.jpg`;
  await store.putBuffer({ key, bytes, contentType: "image/jpeg", sha256 });

  const download = await store.getVerified(key);
  assert.equal(client.lastBody.destroyed, false);
  download.body.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.lastBody.destroyed, true);
});

test("R2 downloads verify streamed bytes rather than trusting metadata", async () => {
  const client = new FakeS3Client();
  const store = storage(client);
  const bytes = Buffer.from("synthetic-media-only");
  const sha256 = sha256Hex(bytes);
  const key = `masters/${ORGANIZATION_ID}/asset/version/${sha256}.jpg`;
  await store.putBuffer({ key, bytes, contentType: "image/jpeg", sha256 });

  const identity = `pixel-media-spike/${key}`;
  client.objects.get(identity).bytes = Buffer.from("tampered-media");
  const download = await store.getVerified(key);

  await assert.rejects(consume(download), /download (?:length|checksum) mismatch/);
});
