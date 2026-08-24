import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const originModule = await tsImport(
  "../lib/security/request-origin.ts",
  import.meta.url,
);
const exports = originModule.default ?? originModule;
const { isSameOriginRequest } = exports;
const routeSource = await readFile(
  path.join(process.cwd(), "app/api/auth/bridge/route.ts"),
  "utf8",
);

test("same-origin bridge requests are accepted on canonical and preview hosts", () => {
  assert.equal(
    isSameOriginRequest(
      "https://pixelblastermedia.com",
      "https://pixelblastermedia.com/api/auth/bridge",
    ),
    true,
  );
  assert.equal(
    isSameOriginRequest(
      "https://preview-name.vercel.app",
      "https://preview-name.vercel.app/api/auth/bridge",
    ),
    true,
  );
  assert.equal(
    isSameOriginRequest(
      "https://pixelblastermedia.com",
      "http://localhost:3000/api/auth/bridge",
      {
        host: "pixelblastermedia.com",
        forwardedProto: "https",
      },
    ),
    true,
  );
});

test("the canonical marketing proxy supplies the browser origin through a trusted stable upstream", () => {
  assert.equal(
    isSameOriginRequest(
      "https://pixelblastermedia.com",
      "https://pixel-blaster-media.vercel.app/api/auth/bridge",
      {
        host: "pixel-blaster-media.vercel.app",
        forwardedHost: "pixelblastermedia.com",
        forwardedProto: "https",
        productionProxyHost: "pixel-blaster-media.vercel.app",
        trustedProductionProxy: true,
      },
    ),
    true,
  );

  for (const external of [
    {
      host: "pixel-blaster-media.vercel.app",
      forwardedHost: "pixelblastermedia.com",
      forwardedProto: "https",
      productionProxyHost: "pixel-blaster-media.vercel.app",
      trustedProductionProxy: false,
    },
    {
      host: "pixel-blaster-media-abc123.vercel.app",
      forwardedHost: "pixelblastermedia.com",
      forwardedProto: "https",
      productionProxyHost: "pixel-blaster-media.vercel.app",
    },
    {
      host: "pixel-blaster-media.vercel.app",
      forwardedHost: "attacker.example",
      forwardedProto: "https",
      productionProxyHost: "pixel-blaster-media.vercel.app",
    },
  ]) {
    assert.equal(
      isSameOriginRequest(
        "https://pixelblastermedia.com",
        "https://pixel-blaster-media.vercel.app/api/auth/bridge",
        external,
      ),
      false,
    );
  }
});

test("malformed external-authority headers fail closed", () => {
  for (const external of [
    { host: "pixelblastermedia.com/attacker", forwardedProto: "https" },
    { host: "pixelblastermedia.com@attacker.example", forwardedProto: "https" },
    { host: "pixelblastermedia.com", forwardedProto: "https,http" },
    { host: "", forwardedProto: "https" },
  ]) {
    assert.equal(
      isSameOriginRequest(
        "https://pixelblastermedia.com",
        "http://localhost:3000/api/auth/bridge",
        external,
      ),
      false,
    );
  }
});

test("missing, opaque, malformed, cross-origin, and port-mismatched origins fail closed", () => {
  for (const origin of [
    null,
    "null",
    "not a URL",
    "https://attacker.example",
    "https://pixelblastermedia.com:444",
    "http://pixelblastermedia.com",
  ]) {
    assert.equal(
      isSameOriginRequest(
        origin,
        "https://pixelblastermedia.com/api/auth/bridge",
      ),
      false,
      String(origin),
    );
  }
});

test("the auth bridge verifies proxy attestation and same-origin status before reading credentials", () => {
  const attestationCheck = routeSource.indexOf("await verifyProductionProxyRequest(");
  const originCheck = routeSource.indexOf("if (!isSameOriginRequest(");
  const bodyRead = routeSource.indexOf("readBoundedJsonBody(");
  const verifier = routeSource.indexOf("requireVerifiedAccessToken(");

  assert.ok(attestationCheck >= 0, "missing route-level proxy attestation check");
  assert.ok(originCheck > attestationCheck, "origin validation precedes proxy attestation");
  assert.ok(bodyRead > originCheck, "request body is read before origin validation");
  assert.ok(verifier > bodyRead, "credentials are verified before request validation");
  assert.match(routeSource, /jsonError\("Cross-origin request rejected\."\s*,\s*403\)/);
});
