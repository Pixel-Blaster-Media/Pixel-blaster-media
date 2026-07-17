const INTERNAL_ORIGIN = "https://internal.invalid";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

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
