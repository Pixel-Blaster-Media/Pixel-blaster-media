const INTERNAL_ORIGIN = "https://internal.invalid";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeAppOrigin(
  configuredOrigin: string | undefined,
  fallbackOrigin: string,
): string {
  for (const candidate of [configuredOrigin, fallbackOrigin]) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      const isLocalHttp =
        parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
      if (parsed.protocol === "https:" || isLocalHttp) return parsed.origin;
    } catch {
      // Try the trusted request-origin fallback next.
    }
  }
  return INTERNAL_ORIGIN;
}

export function safeNextPath(
  next: string | null,
  fallback = "/admin/settings/business?welcome=1",
): string {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    CONTROL_CHARACTERS.test(next)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(next, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN) return fallback;

    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (
      parsed.pathname.startsWith("/auth/") ||
      parsed.pathname.startsWith("/start/oauth/")
    ) {
      return fallback;
    }
    return normalized;
  } catch {
    return fallback;
  }
}
