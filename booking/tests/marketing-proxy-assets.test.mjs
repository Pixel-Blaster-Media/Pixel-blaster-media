import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
);

test("marketing proxy serves booking assets through an external redirect", () => {
  const assetRule = config.redirects.find(
    (rule) => rule.source === "/_next/:path*",
  );
  assert.deepEqual(assetRule, {
    source: "/_next/:path*",
    destination: "https://pixel-blaster-media.vercel.app/_next/:path*",
    permanent: false,
  });
  assert.equal(
    config.rewrites.some((rule) => rule.source === "/_next/:path*"),
    false,
  );
});
