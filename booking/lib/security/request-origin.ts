export interface ExternalRequestAuthority {
  host: string | null | undefined;
  forwardedHost?: string | null | undefined;
  forwardedProto: string | null | undefined;
  productionProxyHost?: string | null | undefined;
  trustedProductionProxy?: boolean;
}

/**
 * Validates the browser-controlled Origin header against the externally visible
 * request URL. Session-establishing routes reject requests without a concrete,
 * exact origin rather than relying on CORS to prevent side effects.
 */
export function isSameOriginRequest(
  originHeader: string | null | undefined,
  requestUrl: string | URL,
  externalAuthority?: ExternalRequestAuthority,
): boolean {
  if (!originHeader || originHeader === "null") return false;

  try {
    const origin = new URL(originHeader);
    const request = requestUrl instanceof URL ? requestUrl : new URL(requestUrl);

    if (
      (origin.protocol !== "https:" && origin.protocol !== "http:") ||
      (request.protocol !== "https:" && request.protocol !== "http:") ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      (origin.pathname !== "/" && origin.pathname !== "")
    ) {
      return false;
    }

    const expectedOrigin = externalAuthority
      ? originFromExternalAuthority(request, externalAuthority)
      : request.origin;
    return Boolean(expectedOrigin && origin.origin === expectedOrigin);
  } catch {
    return false;
  }
}

function originFromExternalAuthority(
  request: URL,
  authority: ExternalRequestAuthority,
): string | null {
  const requestHost = normalizeAuthorityHost(authority.host);
  const forwardedHost = normalizeAuthorityHost(authority.forwardedHost);
  const productionProxyHost = normalizeAuthorityHost(
    authority.productionProxyHost,
  );
  const trustedProductionProxy = Boolean(
    authority.trustedProductionProxy &&
      requestHost &&
      forwardedHost &&
      productionProxyHost &&
      requestHost === productionProxyHost,
  );
  const host = trustedProductionProxy ? forwardedHost : requestHost;
  const forwardedProto = authority.forwardedProto?.trim() ?? "";
  const protocol = trustedProductionProxy
    ? "https"
    : forwardedProto || request.protocol.replace(/:$/, "");

  if (!host || (protocol !== "https" && protocol !== "http")) {
    return null;
  }

  try {
    const external = new URL(`${protocol}://${host}`);
    if (
      external.username ||
      external.password ||
      external.pathname !== "/" ||
      external.search ||
      external.hash
    ) {
      return null;
    }
    return external.origin;
  } catch {
    return null;
  }
}

function normalizeAuthorityHost(
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
      parsed.hash
    ) {
      return null;
    }
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}
