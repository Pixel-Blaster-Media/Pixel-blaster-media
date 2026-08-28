export const SUPABASE_AUTH_COOKIE_READ_CHUNK_LIMIT = 64;
export const SUPABASE_AUTH_COOKIE_CLEANUP_MAX_INDEX = 64;

export type CookieNameLike = Readonly<{ name: string }>;

const AUTH_COOKIE_BASE_PATTERN = /^sb-[A-Za-z0-9_-]+-auth-token$/;

/**
 * Derive the one configured Supabase Auth-cookie base owned by this app.
 * Invalid configuration yields null so callers can fail closed.
 */
export function getSupabaseAuthCookieBaseName(
  supabaseUrl: string | undefined,
): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const projectRef = url.hostname.split(".")[0];
    if (!projectRef || !/^[A-Za-z0-9_-]+$/.test(projectRef)) return null;
    const baseName = `sb-${projectRef}-auth-token`;
    return AUTH_COOKIE_BASE_PATTERN.test(baseName) ? baseName : null;
  } catch {
    return null;
  }
}

/**
 * Return a canonical, app-owned chunk index. Leading zeroes and indices above
 * the fixed cleanup boundary are deliberately not owned by this app.
 */
export function getSupabaseAuthCookieChunkIndex(
  name: string,
  baseName: string,
): number | null {
  if (!AUTH_COOKIE_BASE_PATTERN.test(baseName)) return null;
  const prefix = `${baseName}.`;
  if (!name.startsWith(prefix)) return null;
  const suffix = name.slice(prefix.length);
  if (!/^(?:0|[1-9]\d?)$/.test(suffix)) return null;
  const index = Number(suffix);
  return index <= SUPABASE_AUTH_COOKIE_CLEANUP_MAX_INDEX ? index : null;
}

export function isSupabaseAuthCookieName(
  name: string,
  baseName: string,
): boolean {
  return (
    (AUTH_COOKIE_BASE_PATTERN.test(baseName) && name === baseName) ||
    getSupabaseAuthCookieChunkIndex(name, baseName) !== null
  );
}

/**
 * The complete fixed cleanup vocabulary. No request-provided name is ever
 * copied into this list, so callers can emit at most 66 cookie mutations.
 */
export function getSupabaseAuthCookieCleanupNames(
  baseName: string,
): readonly string[] {
  if (!AUTH_COOKIE_BASE_PATTERN.test(baseName)) return [];
  return [
    baseName,
    ...Array.from(
      { length: SUPABASE_AUTH_COOKIE_CLEANUP_MAX_INDEX + 1 },
      (_, index) => `${baseName}.${index}`,
    ),
  ];
}

/**
 * Intersect observed cookies with the fixed server-generated cleanup set.
 * Returned names are always generated from baseName, never reflected from a
 * request, and the result is bounded to 66 entries.
 */
export function getPresentSupabaseAuthCookieNames(
  cookies: readonly CookieNameLike[],
  baseName: string,
): string[] {
  const observedNames = new Set(cookies.map((cookie) => cookie.name));
  return getSupabaseAuthCookieCleanupNames(baseName).filter((name) =>
    observedNames.has(name),
  );
}
