import { createHmac, timingSafeEqual } from "crypto";

const RELAY_MARKER_PARAM = "_google_relay";
const RELAY_SIGNATURE_PARAM = "_google_relay_sig";
const RELAY_MARKER_VALUE = "1";
const RELAY_SIGNATURE_CONTEXT =
  "pixel-blaster/google-calendar/callback-relay/v1";
const OAUTH_RESPONSE_FIELDS = ["code", "state", "error"] as const;
const SIGNED_RELAY_FIELDS = new Set([
  ...OAUTH_RESPONSE_FIELDS,
  RELAY_MARKER_PARAM,
  RELAY_SIGNATURE_PARAM,
]);

function hasOnlySingleParams(url: URL, allowed: ReadonlySet<string>): boolean {
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) return false;
  }
  for (const key of allowed) {
    if (url.searchParams.getAll(key).length > 1) return false;
  }
  return true;
}

function canonicalRelayPayload(
  url: URL,
  canonicalCallbackUri: string,
): string {
  return JSON.stringify([
    canonicalCallbackUri,
    ...OAUTH_RESPONSE_FIELDS.map((field) => url.searchParams.get(field)),
  ]);
}

function relaySignature(
  url: URL,
  canonicalCallbackUri: string,
  secret: string,
): string {
  if (!secret) throw new Error("Google Calendar relay secret is missing.");
  return createHmac("sha256", secret)
    .update(RELAY_SIGNATURE_CONTEXT, "utf8")
    .update("\0", "utf8")
    .update(canonicalRelayPayload(url, canonicalCallbackUri), "utf8")
    .digest("hex");
}

export function signGoogleCalendarCallbackRelayUri(
  relayUri: string,
  canonicalCallbackUri: string,
  secret: string,
): string {
  const relay = new URL(relayUri);
  const canonicalCallback = new URL(canonicalCallbackUri);
  if (
    relay.origin !== canonicalCallback.origin ||
    relay.pathname !== canonicalCallback.pathname ||
    relay.username ||
    relay.password ||
    relay.hash ||
    !hasOnlySingleParams(relay, new Set(OAUTH_RESPONSE_FIELDS))
  ) {
    throw new Error("Google Calendar callback relay URI is malformed.");
  }

  const signature = relaySignature(relay, canonicalCallbackUri, secret);
  relay.searchParams.set(RELAY_MARKER_PARAM, RELAY_MARKER_VALUE);
  relay.searchParams.set(RELAY_SIGNATURE_PARAM, signature);
  return relay.toString();
}

export function googleCalendarCallbackHasRelayControls(
  requestUrl: string,
): boolean {
  try {
    const request = new URL(requestUrl);
    return (
      request.searchParams.has(RELAY_MARKER_PARAM) ||
      request.searchParams.has(RELAY_SIGNATURE_PARAM)
    );
  } catch {
    return false;
  }
}

export function googleCalendarCallbackRelayIsVerified(
  requestUrl: string,
  canonicalCallbackUri: string,
  secret: string,
): boolean {
  if (!secret) return false;

  let request: URL;
  let canonicalCallback: URL;
  try {
    request = new URL(requestUrl);
    canonicalCallback = new URL(canonicalCallbackUri);
  } catch {
    return false;
  }

  const signature = request.searchParams.get(RELAY_SIGNATURE_PARAM);
  if (
    request.pathname !== canonicalCallback.pathname ||
    request.hash ||
    request.searchParams.get(RELAY_MARKER_PARAM) !== RELAY_MARKER_VALUE ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !hasOnlySingleParams(request, SIGNED_RELAY_FIELDS)
  ) {
    return false;
  }

  let expected: string;
  try {
    expected = relaySignature(request, canonicalCallbackUri, secret);
  } catch {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  );
}
