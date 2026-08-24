import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const attestationModule = await tsImport(
  "../lib/security/production-proxy-attestation.ts",
  import.meta.url,
);
const {
  PRODUCTION_PROXY_HEADERS,
  signProductionProxyAttestation,
  verifyProductionProxyAttestation,
  verifyProductionProxyRequest,
} = attestationModule.default ?? attestationModule;

const SECRET = "r1-test-only-shared-proxy-secret-0123456789abcdef";
const NOW_SECONDS = 1_787_315_200;
const request = {
  timestamp: String(NOW_SECONDS),
  method: "POST",
  host: "pixelblastermedia.com",
  pathAndQuery: "/api/auth/bridge?intent=sign-in",
};

async function signed(overrides = {}) {
  const fields = { ...request, ...overrides };
  return {
    ...fields,
    signature: await signProductionProxyAttestation(fields, SECRET),
  };
}

test("fresh cross-project proxy attestations verify", async () => {
  assert.equal(
    await verifyProductionProxyAttestation(await signed(), SECRET, NOW_SECONDS),
    true,
  );
});

test("request trust binds signed authority to the exact proxy topology", async () => {
  const attestation = await signed();
  const verification = {
    canonicalHost: "pixelblastermedia.com",
    productionProxyHost: "pixel-blaster-media.vercel.app",
  };
  const requestFor = (signedFields, overrides = {}) => ({
    method: overrides.method ?? signedFields.method,
    url: `https://internal.invalid${signedFields.pathAndQuery}`,
    headers: new Headers({
      host: overrides.rawHost ?? "pixel-blaster-media.vercel.app",
      "x-forwarded-host":
        overrides.forwardedHost ?? "pixelblastermedia.com",
      "x-forwarded-proto": overrides.forwardedProto ?? "https",
      [PRODUCTION_PROXY_HEADERS.timestamp]: signedFields.timestamp,
      [PRODUCTION_PROXY_HEADERS.host]: signedFields.host,
      [PRODUCTION_PROXY_HEADERS.signature]: signedFields.signature,
    }),
  });

  assert.equal(
    await verifyProductionProxyRequest(
      requestFor(attestation),
      SECRET,
      verification,
      NOW_SECONDS,
    ),
    true,
  );

  const wrongHostAttestation = await signed({ host: "attacker.example" });
  for (const candidate of [
    requestFor(attestation, { forwardedHost: "attacker.example" }),
    requestFor(attestation, {
      rawHost: "generated-deployment.vercel.app",
    }),
    requestFor(attestation, { forwardedProto: "http" }),
    requestFor(wrongHostAttestation, { forwardedHost: "attacker.example" }),
  ]) {
    assert.equal(
      await verifyProductionProxyRequest(
        candidate,
        SECRET,
        verification,
        NOW_SECONDS,
      ),
      false,
    );
  }
});

test("proxy attestations bind method, public host, path, query, and timestamp", async () => {
  const attestation = await signed();

  for (const mutation of [
    { method: "GET" },
    { host: "attacker.example" },
    { pathAndQuery: "/api/auth/bridge?intent=reset" },
    { timestamp: String(NOW_SECONDS - 31) },
    { timestamp: String(NOW_SECONDS + 31) },
    { signature: "00".repeat(32) },
  ]) {
    assert.equal(
      await verifyProductionProxyAttestation(
        { ...attestation, ...mutation },
        SECRET,
        NOW_SECONDS,
      ),
      false,
      JSON.stringify(mutation),
    );
  }
});

test("missing, malformed, stale, future, and weak-secret attestations fail closed", async () => {
  const attestation = await signed();

  for (const candidate of [
    { ...attestation, timestamp: "not-a-number" },
    { ...attestation, timestamp: "1.5" },
    { ...attestation, timestamp: "-1" },
    { ...attestation, host: "pixelblastermedia.com\nattacker.example" },
    { ...attestation, pathAndQuery: "api/auth/bridge" },
    { ...attestation, signature: "not-hex" },
  ]) {
    assert.equal(
      await verifyProductionProxyAttestation(candidate, SECRET, NOW_SECONDS),
      false,
    );
  }

  assert.equal(
    await verifyProductionProxyAttestation(attestation, "short", NOW_SECONDS),
    false,
  );
  assert.equal(
    await verifyProductionProxyAttestation(attestation, undefined, NOW_SECONDS),
    false,
  );
});

test("the marketing middleware overwrites client attestation headers before forwarding", async () => {
  const middlewareSource = await readFile(
    path.join(process.cwd(), "..", "middleware.js"),
    "utf8",
  );

  for (const header of Object.values(PRODUCTION_PROXY_HEADERS)) {
    const deleteIndex = middlewareSource.indexOf(`requestHeaders.delete(${JSON.stringify(header)})`);
    const setIndex = middlewareSource.indexOf(`requestHeaders.set(${JSON.stringify(header)}`);
    assert.ok(deleteIndex >= 0, `marketing middleware does not delete ${header}`);
    assert.ok(setIndex > deleteIndex, `marketing middleware does not overwrite ${header}`);
  }
  assert.match(middlewareSource, /signProxyAttestation/);
  assert.match(middlewareSource, /BOOKING_PROXY_SHARED_SECRET/);
});
