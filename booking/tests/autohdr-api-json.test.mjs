import assert from "node:assert/strict";
import test from "node:test";

import { readAutoHDRApiJson } from "../lib/integrations/autohdr/browser-api.ts";

test("browser API JSON requires JSON content type, bounded bodies, and successful status", async () => {
  await assert.rejects(
    readAutoHDRApiJson(new Response("<html>proxy error</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    })),
    /unexpected response/i,
  );
  await assert.rejects(
    readAutoHDRApiJson(new Response(JSON.stringify({ ok: false, error: "Safe provider error", code: "safe" }), {
      status: 409,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })),
    (error) => error?.message === "Safe provider error",
  );
  await assert.rejects(
    readAutoHDRApiJson(new Response(JSON.stringify({ ok: true, padding: "x".repeat(70_000) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })),
    /too large/i,
  );
  assert.deepEqual(
    await readAutoHDRApiJson(new Response(JSON.stringify({ ok: true, value: 7 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })),
    { ok: true, value: 7 },
  );
});
