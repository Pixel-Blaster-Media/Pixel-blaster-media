const ATTESTATION_VERSION = "pixel-booking-proxy-v1";
const MAX_CLOCK_SKEW_SECONDS = 30;
const MINIMUM_SECRET_BYTES = 32;

export const PRODUCTION_PROXY_HEADERS = Object.freeze({
  timestamp: "x-pixel-proxy-timestamp",
  host: "x-pixel-proxy-host",
  signature: "x-pixel-proxy-signature",
});

type UnsignedProxyAttestation = {
  timestamp: string | null | undefined;
  method: string;
  host: string | null | undefined;
  pathAndQuery: string;
};

type ProxyAttestation = UnsignedProxyAttestation & {
  signature: string | null | undefined;
};

type RequestLike = {
  method: string;
  url: string;
  headers: Pick<Headers, "get">;
};

export interface ProductionProxyVerificationOptions {
  canonicalHost: string | null | undefined;
  productionProxyHost: string | null | undefined;
}

const encoder = new TextEncoder();

function normalizeUnsignedAttestation(input: UnsignedProxyAttestation) {
  const timestamp = input.timestamp ?? "";
  const method = input.method.toUpperCase();
  const host = (input.host ?? "").toLowerCase();
  const pathAndQuery = input.pathAndQuery;

  if (!/^\d{1,12}$/.test(timestamp)) {
    throw new Error("Invalid proxy timestamp.");
  }
  if (!/^[A-Z]+$/.test(method)) {
    throw new Error("Invalid proxy method.");
  }
  if (
    host.length === 0 ||
    host.length > 253 ||
    host.includes(":") ||
    host.includes("/") ||
    host.includes("@") ||
    host.includes("\r") ||
    host.includes("\n")
  ) {
    throw new Error("Invalid proxy host.");
  }
  if (
    !pathAndQuery.startsWith("/") ||
    pathAndQuery.includes("\r") ||
    pathAndQuery.includes("\n")
  ) {
    throw new Error("Invalid proxy path.");
  }

  return { timestamp, method, host, pathAndQuery };
}

function requireStrongSecret(secret: string | null | undefined) {
  if (!secret || encoder.encode(secret).byteLength < MINIMUM_SECRET_BYTES) {
    throw new Error("Proxy attestation secret is missing or too short.");
  }
  return secret;
}

function payload(input: UnsignedProxyAttestation) {
  const normalized = normalizeUnsignedAttestation(input);
  return encoder.encode(
    [
      ATTESTATION_VERSION,
      normalized.timestamp,
      normalized.method,
      normalized.host,
      normalized.pathAndQuery,
    ].join("\n"),
  );
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function fromHex(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("Invalid proxy signature.");
  }
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    result[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return result;
}

async function hmacKey(secret: string | null | undefined, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(requireStrongSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signProductionProxyAttestation(
  input: UnsignedProxyAttestation,
  secret: string,
) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    payload(input),
  );
  return hex(signature);
}

export async function verifyProductionProxyAttestation(
  input: ProxyAttestation,
  secret: string | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  try {
    const normalized = normalizeUnsignedAttestation(input);
    const timestamp = Number(normalized.timestamp);
    if (
      !Number.isSafeInteger(timestamp) ||
      !Number.isSafeInteger(nowSeconds) ||
      Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS
    ) {
      return false;
    }

    return await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret, "verify"),
      fromHex(input.signature ?? ""),
      payload(normalized),
    );
  } catch {
    return false;
  }
}

export async function verifyProductionProxyRequest(
  request: RequestLike,
  secret: string | null | undefined,
  options: ProductionProxyVerificationOptions,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  const expectedCanonicalHost = normalizeTopologyHost(options.canonicalHost);
  const expectedProductionProxyHost = normalizeTopologyHost(
    options.productionProxyHost,
  );
  const requestHost = normalizeTopologyHost(request.headers.get("host"));
  const forwardedHost = normalizeTopologyHost(
    request.headers.get("x-forwarded-host"),
  );
  const signedHost = normalizeTopologyHost(
    request.headers.get(PRODUCTION_PROXY_HEADERS.host),
  );
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
  if (
    !expectedCanonicalHost ||
    !expectedProductionProxyHost ||
    requestHost !== expectedProductionProxyHost ||
    forwardedHost !== expectedCanonicalHost ||
    signedHost !== expectedCanonicalHost ||
    forwardedProto !== "https"
  ) {
    return false;
  }

  return verifyProductionProxyAttestation(
    {
      timestamp: request.headers.get(PRODUCTION_PROXY_HEADERS.timestamp),
      method: request.method,
      host: request.headers.get(PRODUCTION_PROXY_HEADERS.host),
      pathAndQuery: `${url.pathname}${url.search}`,
      signature: request.headers.get(PRODUCTION_PROXY_HEADERS.signature),
    },
    secret,
    nowSeconds,
  );
}

function normalizeTopologyHost(
  value: string | null | undefined,
): string | null {
  const host = value?.trim() ?? "";
  if (!host || /[\\/@,?#\u0000-\u0020\u007f]/.test(host)) return null;

  try {
    const parsed = new URL(`https://${host}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      (parsed.port && parsed.port !== "443")
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}
