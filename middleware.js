import { next } from "@vercel/functions";

const DEFAULT_CANONICAL_HOST = "pixelblastermedia.com";
const ATTESTATION_VERSION = "pixel-booking-proxy-v1";
const NEXT_QUERY_PARAM_PREFIXES = ["nxtP", "nxtI"];
const encoder = new TextEncoder();
const BOOKING_PROXY_PREFIXES = [
  "/_next",
  "/book",
  "/portal",
  "/auth",
  "/admin",
  "/api",
  "/listings",
  "/beta",
  "/start",
  "/icons",
];
const BOOKING_PROXY_FILES = new Set([
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
  "/icon.png",
  "/apple-icon.png",
]);

function isBookingProxyPath(pathname) {
  return (
    BOOKING_PROXY_FILES.has(pathname) ||
    BOOKING_PROXY_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

function proxyUnavailable() {
  return new Response("Booking service is temporarily unavailable.", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function invalidProxyUrl() {
  return new Response("Invalid booking request URL.", {
    status: 400,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

/**
 * Vercel invokes the booking middleware through Next's Edge adapter, which
 * normalizes RSC and Pages Router data paths plus reserved rewrite query keys
 * and removes `_rsc`. Mirror those locked Next 16.3 transformations in order;
 * reject ambiguous malformed data forms rather than risking another canonical
 * redirect loop.
 */
function proxyAttestationPathAndQuery(url) {
  const attestationUrl = new URL(url.href.replace(/\.rsc($|\?)/, "$1"));

  if (
    attestationUrl.pathname.startsWith("/_next/data/") &&
    attestationUrl.pathname.endsWith(".json")
  ) {
    const dataPathParts = attestationUrl.pathname
      .replace(/^\/_next\/data\//, "")
      .replace(/\.json$/, "")
      .split("/");
    if (dataPathParts[1] === "index" && dataPathParts.length > 2) {
      return null;
    }
    attestationUrl.pathname =
      dataPathParts[1] === "index"
        ? "/"
        : `/${dataPathParts.slice(1).join("/")}`;

    if (
      attestationUrl.pathname.startsWith("/_next/data/") &&
      attestationUrl.pathname.endsWith(".json")
    ) {
      return null;
    }
  }

  const keys = [...attestationUrl.searchParams.keys()];

  for (const key of keys) {
    const values = attestationUrl.searchParams.getAll(key);
    const normalizedKey = NEXT_QUERY_PARAM_PREFIXES.find(
      (prefix) => key !== prefix && key.startsWith(prefix),
    );
    if (!normalizedKey) continue;

    const applicationKey = key.slice(normalizedKey.length);
    attestationUrl.searchParams.delete(applicationKey);
    for (const value of values) {
      attestationUrl.searchParams.append(applicationKey, value);
    }
    attestationUrl.searchParams.delete(key);
  }

  attestationUrl.searchParams.delete("_rsc");
  return `${attestationUrl.pathname}${attestationUrl.search}`;
}

async function signProxyAttestation({ timestamp, method, host, pathAndQuery }, secret) {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error("Proxy attestation secret is too short.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = encoder.encode(
    [ATTESTATION_VERSION, timestamp, method, host, pathAndQuery].join("\n"),
  );
  const signature = await crypto.subtle.sign("HMAC", key, payload);
  return Array.from(new Uint8Array(signature), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export const config = {
  matcher: "/:path*",
};

export default async function middleware(request) {
  const requestHeaders = new Headers(request.headers);

  // Never forward attestation material supplied by the public client.
  requestHeaders.delete("x-pixel-proxy-timestamp");
  requestHeaders.delete("x-pixel-proxy-host");
  requestHeaders.delete("x-pixel-proxy-signature");

  const url = new URL(request.url);
  const canonicalHost = (
    process.env.BOOKING_PROXY_CANONICAL_HOST ?? DEFAULT_CANONICAL_HOST
  ).toLowerCase();
  const secret = process.env.BOOKING_PROXY_SHARED_SECRET;

  if (
    url.hostname.toLowerCase() === canonicalHost &&
    isBookingProxyPath(url.pathname)
  ) {
    if (!secret || encoder.encode(secret).byteLength < 32) {
      return proxyUnavailable();
    }

    const timestamp = String(Math.floor(Date.now() / 1_000));
    const method = request.method.toUpperCase();
    const host = url.hostname.toLowerCase();
    const pathAndQuery = proxyAttestationPathAndQuery(url);
    if (pathAndQuery === null) {
      return invalidProxyUrl();
    }
    const signature = await signProxyAttestation(
      { timestamp, method, host, pathAndQuery },
      secret,
    );

    requestHeaders.set("x-forwarded-host", host);
    requestHeaders.set("x-forwarded-proto", "https");
    requestHeaders.set("x-pixel-proxy-timestamp", timestamp);
    requestHeaders.set("x-pixel-proxy-host", host);
    requestHeaders.set("x-pixel-proxy-signature", signature);
  }

  return next({ request: { headers: requestHeaders } });
}
