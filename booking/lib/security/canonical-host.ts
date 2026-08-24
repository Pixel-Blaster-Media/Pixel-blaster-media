export type CanonicalHostAction = "pass" | "redirect" | "reject";

export interface CanonicalHostRequest {
  canonicalHost: string;
  forwardedHost?: string | null;
  host: string | null | undefined;
  method: string;
  pathname: string;
  productionProxyHost?: string | null;
  trustedProductionProxy?: boolean;
  vercelEnvironment: string | null | undefined;
}

/**
 * Contains browser and provider traffic to the configured production domain
 * instead of generated Vercel deployment URLs or stale aliases. This is a
 * canonical-host control. Stable-upstream forwarded authority is accepted only
 * after the marketing project supplies a fresh, cryptographically verified
 * proxy attestation. Preview/local deployments remain directly reachable, and
 * remain available because the cron handlers enforce their own shared secret.
 */
export function canonicalHostAction(
  request: CanonicalHostRequest,
): CanonicalHostAction {
  if (request.vercelEnvironment !== "production") return "pass";

  const host = normalizeHost(request.host);
  const canonicalHost = normalizeHost(request.canonicalHost);
  const productionProxyHost = normalizeHost(request.productionProxyHost);
  const forwardedHost = normalizeHost(request.forwardedHost);
  const method = request.method.toUpperCase();

  const publicHost =
    request.trustedProductionProxy &&
    host &&
    productionProxyHost &&
    host === productionProxyHost &&
    forwardedHost
      ? forwardedHost
      : host;
  if (publicHost && canonicalHost && publicHost === canonicalHost) return "pass";
  if (
    request.pathname === "/api/cron" ||
    request.pathname.startsWith("/api/cron/")
  ) {
    return "pass";
  }

  return method === "GET" || method === "HEAD" ? "redirect" : "reject";
}

function normalizeHost(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  const separator = normalized.lastIndexOf(":");
  if (separator > -1 && !normalized.includes("]")) {
    return normalized.slice(0, separator);
  }
  return normalized;
}
