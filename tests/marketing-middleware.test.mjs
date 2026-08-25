import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import test from "node:test";

import middleware from "../middleware.js";
import {
  PRODUCTION_PROXY_HEADERS,
  verifyProductionProxyAttestation,
  verifyProductionProxyRequest,
} from "../booking/lib/security/production-proxy-attestation.ts";

const SECRET = "marketing-test-proxy-secret-0123456789abcdef";
globalThis.AsyncLocalStorage = AsyncLocalStorage;
const { adapter } = await import(
  "../booking/node_modules/next/dist/server/web/adapter.js"
);

const nextPackage = JSON.parse(
  await readFile(
    new URL("../booking/node_modules/next/package.json", import.meta.url),
    "utf8",
  ),
);

assert.equal(
  nextPackage.version,
  "16.3.0",
  "review marketing attestation normalization before changing locked Next",
);

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

async function nextEdgeMiddlewareVisibleUrl(publicUrl) {
  let visibleUrl = null;
  await adapter({
    page: "middleware",
    request: {
      url: publicUrl,
      method: "GET",
      headers: {},
      nextConfig: {},
      signal: new AbortController().signal,
      waitUntil: Promise.resolve(),
    },
    handler: async (request) => {
      visibleUrl = request.url;
      return new Response(null, { headers: { "x-middleware-next": "1" } });
    },
  });
  assert.ok(visibleUrl, `locked Next Edge adapter did not expose ${publicUrl}`);
  return new URL(visibleUrl);
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

test("proxy proof matches locked Next Edge adapter while binding application query", async () => {
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
    "https://pixelblastermedia.com/admin/bookings.rsc?_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?nxtPfilter=active&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?nxtIfilter=active&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?%6e%78%74%50filter=active&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?nxtP=exact&nxtI=exact&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?nxtP_rsc=framework&keep=app",
    "https://pixelblastermedia.com/admin/bookings?nxtPnxtIfilter=once&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?_RSC=application&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?_rscx=application&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?%5Frsc=framework&keep=app",
    "https://pixelblastermedia.com/admin/bookings?filter=public&nxtPfilter=internal&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?nxtPfilter=one&nxtPfilter=two&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?tag=one&tag=two&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?a=1&b=2&a=3&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?2=two&a=first&1=one&a=second&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?constructor=one&toString=two&__proto__=three&safe=four&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?filter=public&a=1&nxtPfilter=internal&a=2&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?q=.rsc",
    "https://pixelblastermedia.com/admin/bookings?flag&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?bad=%&_rsc=h",
    "https://pixelblastermedia.com/admin/bookings?bad=%C3%28&_rsc=h",
    "https://pixelblastermedia.com/_next/data/build-id/admin/bookings.json?x=1&_rsc=h",
    "https://pixelblastermedia.com/_next/data/build-id/index.json?x=1",
    "https://pixelblastermedia.com/_next/data/build-id/book.json?nxtPfilter=active&_rsc=h",
  ];

  const generatedKeys = [
    "a",
    "b",
    "1",
    "10",
    "filter",
    "nxtPfilter",
    "nxtIfilter",
    "constructor",
    "toString",
    "__proto__",
  ];
  for (let vector = 0; vector < 64; vector += 1) {
    const searchParams = new URLSearchParams();
    for (let field = 0; field < 6; field += 1) {
      const key = generatedKeys[(vector * 3 + field * 7) % generatedKeys.length];
      searchParams.append(key, `value ${vector}-${field}`);
      if ((vector + field) % 5 === 0) {
        searchParams.append(key, `duplicate+${vector}-${field}`);
      }
    }
    searchParams.append("_rsc", `generated-${vector}`);
    publicUrls.push(
      `https://pixelblastermedia.com/admin/bookings?${searchParams}`,
    );
  }

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
    const appVisibleUrl = await nextEdgeMiddlewareVisibleUrl(publicUrl);
    const upstreamUrl = new URL(
      appVisibleUrl.pathname + appVisibleUrl.search,
      "https://internal.invalid",
    );

    const verify = (method, candidateUrl) =>
      verifyProductionProxyRequest(
        {
          method,
          url: candidateUrl.href,
          headers: upstreamHeaders,
        },
        SECRET,
        topology,
      );

    assert.equal(
      await verify("GET", upstreamUrl),
      true,
      `attestation must match Next-visible URL for ${publicUrl}`,
    );

    const queryAppendMutation = new URL(upstreamUrl);
    queryAppendMutation.searchParams.append("tampered", "1");
    const pathMutation = new URL(upstreamUrl);
    pathMutation.pathname = `${pathMutation.pathname.replace(/\/$/, "")}/tampered`;
    const mutations = [
      ["method", "POST", upstreamUrl],
      ["path", "GET", pathMutation],
      ["query append", "GET", queryAppendMutation],
    ];
    const entries = [...upstreamUrl.searchParams.entries()];

    if (entries.length > 0) {
      const queryValueMutation = new URL(upstreamUrl);
      queryValueMutation.searchParams.set(
        entries[0][0],
        `${entries[0][1]}-tampered`,
      );
      mutations.push(["query value/count", "GET", queryValueMutation]);
    }

    if (entries.length > 1) {
      const queryOrderMutation = new URL(upstreamUrl);
      queryOrderMutation.search = new URLSearchParams(entries.reverse()).toString();
      if (queryOrderMutation.search !== upstreamUrl.search) {
        mutations.push(["query order", "GET", queryOrderMutation]);
      }
    }

    for (const [label, method, mutationUrl] of mutations) {
      assert.equal(
        await verify(method, mutationUrl),
        false,
        `${label} mutation must fail for ${publicUrl}`,
      );
    }
  }
});

test("ambiguous data URLs fail once before proxy signing", async () => {
  process.env.BOOKING_PROXY_SHARED_SECRET = SECRET;
  const urls = [
    "https://pixelblastermedia.com/_next/data/outer/_next/data/foo.json.json?x=1&_rsc=h",
    "https://pixelblastermedia.com/_next/data/current/index/foo.json?x=1&_rsc=h",
  ];

  for (const url of urls) {
    const response = await middleware(new Request(url));
    assert.equal(response.status, 400, url);
    assert.equal(response.headers.get("cache-control"), "no-store", url);
    assert.deepEqual(
      forwardedAttestation(response),
      { timestamp: null, host: null, signature: null },
      url,
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
