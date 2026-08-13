import assert from "node:assert/strict";
import test from "node:test";

import { readBoundedAutoHDRJson } from "../lib/integrations/autohdr/request-core.ts";

test("AutoHDR request JSON rejects missing or non-JSON content types before parsing", async () => {
  for (const contentType of [null, "text/plain", "application/problem+json"]) {
    const headers = contentType ? { "Content-Type": contentType } : {};
    await assert.rejects(
      readBoundedAutoHDRJson(new Request("https://example.test", {
        method: "POST",
        headers,
        body: "{}",
      })),
      (error) => error?.code === "invalid_request" && /content type/i.test(error.message),
    );
  }
});
