import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const configUrl = pathToFileURL(path.join(process.cwd(), "next.config.mjs"));
configUrl.searchParams.set("test", String(Date.now()));
const { default: nextConfig } = await import(configUrl.href);

test("all application responses receive the required browser security headers", async () => {
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers();
  const globalRule = rules.find((rule) => rule.source === "/(.*)");
  assert.ok(globalRule, "missing global response-header rule");

  const headers = new Map(
    globalRule.headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(headers.get("permissions-policy") ?? "", /microphone=\(\)/);
  assert.match(headers.get("strict-transport-security") ?? "", /max-age=63072000/);

  const csp = headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});
