import { next } from "@vercel/functions";

const DEFAULT_CANONICAL_HOST = "pixelblastermedia.com";
const ATTESTATION_VERSION = "pixel-booking-proxy-v1";
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

/**
 * Next removes its framework-only `_rsc` cache discriminator before the
 * rewritten request reaches the booking middleware. Sign the same URL the
 * verifier sees while preserving every application query byte and its order.
 */
function proxyAttestationPathAndQuery(url) {
  const rawQuery = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  if (!rawQuery) return url.pathname;

  const applicationQuery = rawQuery
    .split("&")
    .filter((field) => !isNextRscField(field))
    .join("&");
  return applicationQuery ? `${url.pathname}?${applicationQuery}` : url.pathname;
}

function isNextRscField(field) {
  const separator = field.indexOf("=");
  const rawKey = separator === -1 ? field : field.slice(0, separator);
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, " ")) === "_rsc";
  } catch {
    return rawKey === "_rsc";
  }
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
