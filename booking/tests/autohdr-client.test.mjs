import assert from "node:assert/strict";
import test from "node:test";

import { createAutoHDRClient } from "../lib/integrations/autohdr/client-core.ts";

const BASE = "https://quantumreachadvertising.com/external-api/v2/";

test("AutoHDR client models the fixed v2 origin without assuming an upload protocol", async () => {
  const calls = [];
  const client = createAutoHDRClient({
    apiKey: "secret-key",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(
        {
          id: 9,
          uid: "shoot_9",
          uploaded_files: ["https://uploads.example/a"],
          status: "created",
          creation_date_utc: "2026-08-12T20:00:00Z",
        },
        { status: 201 },
      );
    },
  });
  const result = await client.createPhotoshoot({
    files: ["a.cr3"],
    uploadCallbackUrl: "https://pixelblastermedia.com/api/integrations/autohdr/callback",
    mockCall: true,
  });
  assert.equal(result.uid, "shoot_9");
  assert.equal(calls[0].url, `${BASE}create-photoshoot-with-presigned-urls`);
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-key");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    files: [{ filename: "a.cr3" }],
    upload_callback_url:
      "https://pixelblastermedia.com/api/integrations/autohdr/callback",
    mock_call: true,
  });
});

test("AutoHDR client polls and retrieves processed photo capabilities", async () => {
  const paths = [];
  const client = createAutoHDRClient({
    apiKey: "secret-key",
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path.endsWith("/get-photoshoot-status/shoot_9")) {
        return Response.json({
          id: 9,
          status: "completed",
          creation_date_utc: "2026-08-12T20:00:00Z",
        });
      }
      return Response.json({
        files: [{ name: "edited.jpg", url: "https://cdn.example/edited.jpg" }],
      });
    },
  });
  assert.equal((await client.getStatus("shoot_9")).normalizedStatus, "ready");
  assert.deepEqual(await client.getProcessedPhotos("shoot_9"), [
    { name: "edited.jpg", url: "https://cdn.example/edited.jpg" },
  ]);
  assert.deepEqual(paths, [
    "/external-api/v2/get-photoshoot-status/shoot_9",
    "/external-api/v2/get-processed-photos/shoot_9",
  ]);
});

test("AutoHDR client finalizes only a validated uid", async () => {
  let body;
  const client = createAutoHDRClient({
    apiKey: "secret-key",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({
        id: 9,
        uid: "shoot_9",
        uploaded_files: [],
        status: "processing",
        creation_date_utc: "2026-08-12T20:00:00Z",
      });
    },
  });
  await client.finalizePhotoshoot("shoot_9", true);
  assert.deepEqual(body, { uid: "shoot_9", mock_call: true });
  await assert.rejects(client.finalizePhotoshoot("../bad"), /uid/i);
});

test("AutoHDR client returns opaque bounded errors without provider response bodies", async () => {
  const client = createAutoHDRClient({
    apiKey: "secret-key",
    fetchImpl: async () =>
      new Response('sensitive provider details token=secret', {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
  });
  await assert.rejects(
    client.getStatus("shoot_9"),
    (error) =>
      error instanceof Error &&
      error.message === "AutoHDR request failed (500)." &&
      !error.message.includes("sensitive"),
  );
});
