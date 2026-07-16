export const GOOGLE_CALENDAR_CALLBACK_PATH =
  "/api/integrations/google-calendar/callback";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseCallbackUri(value: string): URL {
  if (
    value.includes("?") ||
    value.includes("#") ||
    value.includes("@") ||
    value.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    throw new Error(
      "Google Calendar redirect URI cannot contain credentials, whitespace, a query string, or a fragment.",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Google Calendar redirect URI must be an absolute https URL.",
    );
  }

  const localHttp =
    url.protocol === "http:" && LOCAL_HOSTNAMES.has(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(
      "Google Calendar redirect URI must use https (http is allowed only for localhost).",
    );
  }
  if (url.username || url.password) {
    throw new Error("Google Calendar redirect URI cannot contain credentials.");
  }
  if (url.pathname !== GOOGLE_CALENDAR_CALLBACK_PATH) {
    throw new Error(
      `Google Calendar redirect URI must end at ${GOOGLE_CALENDAR_CALLBACK_PATH}.`,
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      "Google Calendar redirect URI cannot contain a query string or fragment.",
    );
  }
  return url;
}

function canonicalCallbackUri(appUrl: string): string {
  const configuredAppUrl = appUrl.trim();
  if (
    !configuredAppUrl ||
    configuredAppUrl.includes("@") ||
    configuredAppUrl.includes("?") ||
    configuredAppUrl.includes("#") ||
    configuredAppUrl.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(configuredAppUrl)
  ) {
    throw new Error(
      "Google Calendar redirect URI cannot be derived from NEXT_PUBLIC_APP_URL.",
    );
  }
  let app: URL;
  try {
    app = new URL(configuredAppUrl);
  } catch {
    throw new Error(
      "Google Calendar redirect URI cannot be derived from NEXT_PUBLIC_APP_URL.",
    );
  }
  return parseCallbackUri(
    new URL(GOOGLE_CALENDAR_CALLBACK_PATH, app.origin).toString(),
  ).toString();
}

export function googleCalendarRedirectUri(
  appUrl: string,
  configuredRedirectUri?: string,
): string {
  const canonical = canonicalCallbackUri(appUrl);
  const configured = configuredRedirectUri?.trim();
  return configured
    ? parseCallbackUri(configured).toString()
    : canonical;
}

function normalizeRequestHost(requestHost: string | null): string {
  const value = requestHost ?? "";
  if (!value || value !== value.trim() || /[,\s/\\@?#]/.test(value)) {
    throw new Error("Google OAuth request host is missing or malformed.");
  }

  let rawHostname: string;
  let rawPort: string | null = null;
  if (value.startsWith("[")) {
    const bracket = value.indexOf("]");
    if (bracket < 0) {
      throw new Error("Google OAuth request host is malformed.");
    }
    rawHostname = value.slice(0, bracket + 1);
    const suffix = value.slice(bracket + 1);
    if (suffix) {
      if (!/^:\d{1,5}$/.test(suffix)) {
        throw new Error("Google OAuth request host is malformed.");
      }
      rawPort = suffix.slice(1);
    }
  } else {
    if (value.includes("[") || value.includes("]")) {
      throw new Error("Google OAuth request host is malformed.");
    }
    const firstColon = value.indexOf(":");
    const lastColon = value.lastIndexOf(":");
    if (firstColon !== lastColon) {
      throw new Error("Google OAuth request host is malformed.");
    }
    if (lastColon >= 0) {
      rawHostname = value.slice(0, lastColon);
      rawPort = value.slice(lastColon + 1);
      if (!/^\d{1,5}$/.test(rawPort)) {
        throw new Error("Google OAuth request host is malformed.");
      }
    } else {
      rawHostname = value;
    }

    const labels = rawHostname.split(".");
    const validLabel =
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
    if (
      rawHostname.length > 253 ||
      labels.some((label) => !validLabel.test(label))
    ) {
      throw new Error("Google OAuth request host is malformed.");
    }
  }

  if (rawPort && (Number(rawPort) < 1 || Number(rawPort) > 65_535)) {
    throw new Error("Google OAuth request host is malformed.");
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${value}`);
  } catch {
    throw new Error("Google OAuth request host is malformed.");
  }
  if (parsed.hostname.toLowerCase() !== rawHostname.toLowerCase()) {
    throw new Error("Google OAuth request host is malformed.");
  }
  return parsed.host.toLowerCase();
}

function normalizeRequestOrigin(requestOrigin: string): string {
  const value = requestOrigin;
  if (
    !value ||
    value !== value.trim() ||
    value.includes(",") ||
    value.includes("@") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    throw new Error("Google OAuth request origin is malformed.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Google OAuth request origin is malformed.");
  }

  const localHttp =
    parsed.protocol === "http:" && LOCAL_HOSTNAMES.has(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !localHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    value !== parsed.origin
  ) {
    throw new Error("Google OAuth request origin is malformed.");
  }
  return parsed.origin;
}

function normalizeRequestReferer(requestReferer: string): string {
  const value = requestReferer;
  if (
    !value ||
    value !== value.trim() ||
    value.includes(",") ||
    value.includes("#") ||
    value.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    throw new Error("Google OAuth request referer is malformed.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Google OAuth request referer is malformed.");
  }

  const localHttp =
    parsed.protocol === "http:" && LOCAL_HOSTNAMES.has(parsed.hostname);
  const authorityEnd = value.indexOf("/", parsed.protocol.length + 2);
  const rawOrigin = authorityEnd >= 0 ? value.slice(0, authorityEnd) : value;
  if (
    (parsed.protocol !== "https:" && !localHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/admin/settings/integrations" ||
    parsed.hash ||
    rawOrigin !== parsed.origin
  ) {
    throw new Error("Google OAuth request referer is malformed.");
  }
  return parsed.origin;
}

export function googleCalendarCanonicalConnectPageUri(
  appUrl: string,
  requestHost: string | null,
  requestOrigin: string | null = null,
  requestReferer: string | null = null,
): string | null {
  const canonicalCallback = new URL(canonicalCallbackUri(appUrl));
  const normalizedHost = normalizeRequestHost(requestHost);
  const sourceOrigin =
    requestOrigin !== null
      ? normalizeRequestOrigin(requestOrigin)
      : requestReferer !== null
        ? normalizeRequestReferer(requestReferer)
        : null;
  const canonicalRequest = sourceOrigin
    ? sourceOrigin === canonicalCallback.origin
    : normalizedHost === canonicalCallback.host.toLowerCase();
  if (canonicalRequest) {
    return null;
  }

  const connectPage = new URL(
    "/admin/settings/integrations",
    canonicalCallback.origin,
  );
  connectPage.searchParams.set("google_connect_host", "1");
  return connectPage.toString();
}

export function googleCalendarCallbackRelayUri(
  requestUrl: string,
  appUrl: string,
  configuredRedirectUri?: string,
): string | null {
  const request = new URL(requestUrl);
  const canonicalCallback = new URL(canonicalCallbackUri(appUrl));
  const authorizedCallback = new URL(
    googleCalendarRedirectUri(appUrl, configuredRedirectUri),
  );

  const isCanonicalCallback =
    request.origin === canonicalCallback.origin &&
    request.pathname === canonicalCallback.pathname;
  if (isCanonicalCallback) return null;

  const isAuthorizedCallback =
    request.origin === authorizedCallback.origin &&
    request.pathname === authorizedCallback.pathname;
  if (!isAuthorizedCallback || authorizedCallback.origin === canonicalCallback.origin) {
    throw new Error("Google Calendar callback origin is not allowed.");
  }

  const relay = new URL(canonicalCallback);
  for (const key of ["code", "state", "error"] as const) {
    const value = request.searchParams.get(key);
    if (value) relay.searchParams.set(key, value);
  }
  return relay.toString();
}
