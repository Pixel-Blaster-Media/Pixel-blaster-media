import assert from "node:assert/strict";
import test from "node:test";

import middleware from "../middleware.js";
import {
  PRODUCTION_PROXY_HEADERS,
  verifyProductionProxyAttestation,
  verifyProductionProxyRequest,
} from "../booking/lib/security/production-proxy-attestation.ts";

const SECRET = "marketing-test-proxy-secret-0123456789abcdef";

function forwardedAttestation(response) {
  return {
    timestamp: response.headers.get(
      `x-middleware-request-${PRODUCTION_PROXY_HEADERS.timestamp}`,
    ),
    host: response.headers.get(
      `x-middleware-request-${PRODUCTION_PROXY_HEADERS.host}`,
    ),
    signature: response.headers.get(
      `x-middleware-request-${PRODUCTION_PROXY_HEADERS.signature}`,
    ),
  };
}

test("canonical marketing requests overwrite client routing proof and forwarding authority", async () => {
  process.env.BOOKING_PROXY_SHARED_SECRET = SECRET;
  const request = new Request(
    "https://pixelblastermedia.com/api/auth/bridge?intent=sign-in",
    {
      method: "POST",
      headers: {
        "x-pixel-proxy-timestamp": "1",
        "x-pixel-proxy-host": "attacker.example",
        "x-pixel-proxy-signature": "attacker",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "http",
      },
    },
  );

  const response = await middleware(request);
  const attestation = forwardedAttestation(response);

  assert.notEqual(attestation.timestamp, "1");
  assert.equal(attestation.host, "pixelblastermedia.com");
  assert.notEqual(attestation.signature, "attacker");
  assert.equal(
    response.headers.get("x-middleware-request-x-forwarded-host"),
    "pixelblastermedia.com",
  );
  assert.equal(
    response.headers.get("x-middleware-request-x-forwarded-proto"),
    "https",
  );
  assert.equal(
    await verifyProductionProxyAttestation(
      {
        ...attestation,
        method: "POST",
        pathAndQuery: "/api/auth/bridge?intent=sign-in",
      },
      SECRET,
    ),
    true,
  );
});

test("proxy proof matches Next's RSC query normalization while binding application query", async () => {
  process.env.BOOKING_PROXY_SHARED_SECRET = SECRET;
  const topology = {
    canonicalHost: "pixelblastermedia.com",
    productionProxyHost: "pixel-blaster-media.vercel.app",
  };
  const publicUrls = [
    "https://pixelblastermedia.com/admin/bookings?filter=active&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?q=two%20words",
    "https://pixelblastermedia.com/admin/bookings?q=two%20words&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?q=tilde~value&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?x=%2f&y=%41&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?x=1&&y=2&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?x=1&_rsc=a&_rsc=b&y=2",
  ];

  for (const publicUrl of publicUrls) {
    const response = await middleware(new Request(publicUrl));
    const attestation = forwardedAttestation(response);
    const upstreamHeaders = new Headers({
      host: "pixel-blaster-media.vercel.app",
      "x-forwarded-host": "pixelblastermedia.com",
      "x-forwarded-proto": "https",
      [PRODUCTION_PROXY_HEADERS.timestamp]: attestation.timestamp,
      [PRODUCTION_PROXY_HEADERS.host]: attestation.host,
      [PRODUCTION_PROXY_HEADERS.signature]: attestation.signature,
    });
    const appVisibleUrl = new URL(publicUrl);
    appVisibleUrl.searchParams.delete("_rsc");
    const upstreamUrl = new URL(
      appVisibleUrl.pathname + appVisibleUrl.search,
      "https://internal.invalid",
    );

    assert.equal(
      await verifyProductionProxyRequest(
        {
          method: "GET",
          url: upstreamUrl.href,
          headers: upstreamHeaders,
        },
        SECRET,
        topology,
      ),
      true,
      `attestation must match Next-visible URL for ${publicUrl}`,
    );

    upstreamUrl.searchParams.append("tampered", "1");
    assert.equal(
      await verifyProductionProxyRequest(
        {
          method: "GET",
          url: upstreamUrl.href,
          headers: upstreamHeaders,
        },
        SECRET,
        topology,
      ),
      false,
      `application query mutation must fail for ${publicUrl}`,
    );
  }
});

test("canonical proxy paths fail closed when the signing secret is missing or weak", async () => {
  for (const secret of [undefined, "short"]) {
    if (secret) process.env.BOOKING_PROXY_SHARED_SECRET = secret;
    else delete process.env.BOOKING_PROXY_SHARED_SECRET;

    const response = await middleware(
      new Request("https://pixelblastermedia.com/api/health", {
        headers: {
          "x-pixel-proxy-timestamp": "1",
          "x-pixel-proxy-host": "pixelblastermedia.com",
          "x-pixel-proxy-signature": "attacker",
        },
      }),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const attestation = forwardedAttestation(response);
    assert.equal(attestation.timestamp, null);
    assert.equal(attestation.host, null);
    assert.equal(attestation.signature, null);
  }
});

test("noncanonical and non-proxy requests cannot forward client attestation", async () => {
  for (const [url, secret] of [
    ["https://attacker.example/api/health", SECRET],
    ["https://pixelblastermedia.com/", SECRET],
  ]) {
    if (secret) process.env.BOOKING_PROXY_SHARED_SECRET = secret;
    else delete process.env.BOOKING_PROXY_SHARED_SECRET;

    const response = await middleware(
      new Request(url, {
        headers: {
          "x-pixel-proxy-timestamp": "1",
          "x-pixel-proxy-host": "pixelblastermedia.com",
          "x-pixel-proxy-signature": "attacker",
        },
      }),
    );
    const attestation = forwardedAttestation(response);
    assert.equal(attestation.timestamp, null);
    assert.equal(attestation.host, null);
    assert.equal(attestation.signature, null);
  }
});
