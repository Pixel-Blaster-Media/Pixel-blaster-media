import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = await readFile(path.join(process.cwd(), "middleware.ts"), "utf8");

test("middleware enforces canonical-host policy before auth processing", () => {
  assert.match(source, /canonicalHostAction/);
  const hostPolicyIndex = source.indexOf("canonicalHostAction({");
  const authHandoffIndex = source.indexOf("shouldHandoffAuthCode(");
  assert.ok(hostPolicyIndex >= 0 && hostPolicyIndex < authHandoffIndex);
  assert.match(source, /NextResponse\.redirect\(canonicalUrl, 307\)/);
  assert.match(source, /redirectResponse\.headers\.set\(\s*["']Cache-Control["'],\s*["']no-store["']\s*\)/s);
  assert.match(source, /status: 421/);
});

test("canonical redirects preserve path and query on the configured app origin", () => {
  assert.match(source, /process\.env\.NEXT_PUBLIC_APP_URL/);
  assert.match(source, /request\.nextUrl\.pathname/);
  assert.match(source, /request\.nextUrl\.search/);
});

test("canonical-host containment runs for static and extension-suffixed paths", () => {
  assert.match(source, /matcher:\s*\[\s*["']\/:path\*["']\s*\]/s);
  assert.doesNotMatch(source, /_next\/static|_next\/image|favicon\.ico|png\|jpg/);
});
