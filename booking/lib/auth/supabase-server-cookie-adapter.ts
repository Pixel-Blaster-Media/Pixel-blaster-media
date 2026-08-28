import {
  getSupabaseAuthCookieBaseName,
  SUPABASE_AUTH_COOKIE_READ_CHUNK_LIMIT,
  type CookieNameLike,
} from "./supabase-auth-cookie-family.ts";
import {
  SUPABASE_SESSION_COOKIE_MAX_ENCODED_LENGTH,
  supabaseSessionExpiryState,
} from "./session-cookie-expiry.ts";

export interface SupabaseSdkCookie extends CookieNameLike {
  value: string;
}

export interface SupabaseSdkCookieMutation<TOptions = unknown>
  extends SupabaseSdkCookie {
  options: TOptions;
}

/**
 * Limit the locked SSR SDK to the configured Auth and PKCE storage keys.
 * Request-controlled prefix-adjacent or noncanonical numeric names never enter
 * the SDK's broader chunk matcher.
 */
export function getSupabaseSdkVisibleCookies(
  requestCookies: readonly SupabaseSdkCookie[],
  supabaseUrl: string | undefined,
): SupabaseSdkCookie[] {
  const authBase = getSupabaseAuthCookieBaseName(supabaseUrl);
  if (!authBase) return [];

  const visibleNames = new Set<string>();
  if (supabaseSessionExpiryState(requestCookies, supabaseUrl) !== "unreadable") {
    for (const name of readableStorageNames(authBase)) visibleNames.add(name);
  }

  for (const auxiliaryBase of [
    `${authBase}-code-verifier`,
    `${authBase}-user`,
  ]) {
    for (const cookie of structurallyReadableFamily(requestCookies, auxiliaryBase)) {
      visibleNames.add(cookie.name);
    }
  }

  return requestCookies.filter((cookie) => visibleNames.has(cookie.name));
}

/**
 * Validate SDK writes against server-generated storage vocabularies. Positive
 * writes must form one canonical primary or contiguous readable chunk family.
 * Deletions are limited to canonical names that were actually observed, so no
 * request-controlled name can be reflected into a Set-Cookie header.
 */
export function getSupabaseSdkCookieMutations<TOptions>(
  observedCookies: readonly SupabaseSdkCookie[],
  requestedMutations: readonly SupabaseSdkCookieMutation<TOptions>[],
  supabaseUrl: string | undefined,
): SupabaseSdkCookieMutation<TOptions>[] {
  const authBase = getSupabaseAuthCookieBaseName(supabaseUrl);
  if (!authBase) {
    if (requestedMutations.some((mutation) => mutation.value)) {
      throw new Error("Unsafe Supabase cookie mutation.");
    }
    return [];
  }

  const storageBases = [
    authBase,
    `${authBase}-code-verifier`,
    `${authBase}-user`,
  ] as const;
  const readableByName = new Map<string, { base: string; index: number | null }>();
  const cleanupByName = new Map<string, string>();
  const cleanupNamesByBase = new Map<string, string[]>();
  for (const base of storageBases) {
    const cleanupNames = [base];
    readableByName.set(base, { base, index: null });
    cleanupByName.set(base, base);
    for (let index = 0; index < SUPABASE_AUTH_COOKIE_READ_CHUNK_LIMIT; index += 1) {
      const name = `${base}.${index}`;
      readableByName.set(name, { base, index });
      cleanupByName.set(name, name);
      cleanupNames.push(name);
    }
    const terminalName = `${base}.${SUPABASE_AUTH_COOKIE_READ_CHUNK_LIMIT}`;
    cleanupByName.set(terminalName, terminalName);
    cleanupNames.push(terminalName);
    cleanupNamesByBase.set(base, cleanupNames);
  }

  const positiveByBase = new Map<
    string,
    Array<SupabaseSdkCookieMutation<TOptions> & { canonicalName: string; index: number | null }>
  >();
  for (const mutation of requestedMutations) {
    if (!mutation.value) continue;
    const readable = readableByName.get(mutation.name);
    if (!readable) throw new Error("Unsafe Supabase cookie mutation.");
    const mutations = positiveByBase.get(readable.base) ?? [];
    mutations.push({
      ...mutation,
      canonicalName: readable.index === null ? readable.base : `${readable.base}.${readable.index}`,
      index: readable.index,
    });
    positiveByBase.set(readable.base, mutations);
  }

  for (const mutations of positiveByBase.values()) {
    const primary = mutations.filter((mutation) => mutation.index === null);
    const chunks = mutations.filter((mutation) => mutation.index !== null);
    if (primary.length > 0) {
      if (
        primary.length !== 1 ||
        primary[0].value.length > SUPABASE_SESSION_COOKIE_MAX_ENCODED_LENGTH ||
        chunks.length !== 0
      ) {
        throw new Error("Unsafe Supabase cookie mutation.");
      }
      continue;
    }
    const indices = chunks.map((mutation) => mutation.index as number);
    const unique = new Set(indices);
    const maxIndex = Math.max(...indices);
    if (
      chunks.length === 0 ||
      chunks.reduce((total, mutation) => total + mutation.value.length, 0) >
        SUPABASE_SESSION_COOKIE_MAX_ENCODED_LENGTH ||
      unique.size !== chunks.length ||
      !unique.has(0) ||
      unique.size !== maxIndex + 1
    ) {
      throw new Error("Unsafe Supabase cookie mutation.");
    }
  }

  const observedNames = new Set(observedCookies.map((cookie) => cookie.name));
  const replacementNamesByBase = new Map<string, Set<string>>();
  for (const [base, mutations] of positiveByBase) {
    replacementNamesByBase.set(
      base,
      new Set(mutations.map((mutation) => mutation.canonicalName)),
    );
  }
  const explicitDeletionByName = new Map<
    string,
    SupabaseSdkCookieMutation<TOptions>
  >();
  for (const mutation of requestedMutations) {
    if (mutation.value) continue;
    const canonicalName = cleanupByName.get(mutation.name);
    if (
      canonicalName &&
      observedNames.has(canonicalName) &&
      !explicitDeletionByName.has(canonicalName)
    ) {
      explicitDeletionByName.set(canonicalName, {
        ...mutation,
        name: canonicalName,
      });
    }
  }

  const emittedDeletions = new Set<string>();
  const preparedReplacementBases = new Set<string>();
  const safe: SupabaseSdkCookieMutation<TOptions>[] = [];
  for (const mutation of requestedMutations) {
    if (mutation.value) {
      const readable = readableByName.get(mutation.name);
      if (!readable) throw new Error("Unsafe Supabase cookie mutation.");
      const canonicalName =
        readable.index === null
          ? readable.base
          : `${readable.base}.${readable.index}`;

      if (!preparedReplacementBases.has(readable.base)) {
        preparedReplacementBases.add(readable.base);
        const replacementNames = replacementNamesByBase.get(readable.base) ??
          new Set<string>();
        for (const staleName of cleanupNamesByBase.get(readable.base) ?? []) {
          if (
            !observedNames.has(staleName) ||
            replacementNames.has(staleName) ||
            emittedDeletions.has(staleName)
          ) {
            continue;
          }
          emittedDeletions.add(staleName);
          const requestedDeletion = explicitDeletionByName.get(staleName);
          safe.push(
            requestedDeletion ?? {
              name: staleName,
              value: "",
              options: deletionOptions(mutation.options),
            },
          );
        }
      }

      safe.push({ ...mutation, name: canonicalName });
      continue;
    }

    const canonicalName = cleanupByName.get(mutation.name);
    if (
      !canonicalName ||
      !observedNames.has(canonicalName) ||
      emittedDeletions.has(canonicalName)
    ) {
      continue;
    }
    emittedDeletions.add(canonicalName);
    safe.push({ ...mutation, name: canonicalName });
  }
  return safe;
}

function deletionOptions<TOptions>(options: TOptions): TOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Unsafe Supabase cookie mutation.");
  }
  return { ...options, maxAge: 0 } as TOptions;
}

function structurallyReadableFamily(
  requestCookies: readonly SupabaseSdkCookie[],
  baseName: string,
): SupabaseSdkCookie[] {
  const readableNames = readableStorageNames(baseName);
  const readableSet = new Set(readableNames);
  const family = requestCookies.filter((cookie) => readableSet.has(cookie.name));
  if (requestCookies.some((cookie) => cookie.name === `${baseName}.64`)) return [];

  const primary = family.filter((cookie) => cookie.name === baseName);
  const chunks = family.filter((cookie) => cookie.name !== baseName);
  if (primary.length > 0) {
    return primary.length === 1 &&
      primary[0].value.length <= SUPABASE_SESSION_COOKIE_MAX_ENCODED_LENGTH &&
      chunks.length === 0 &&
      primary[0].value
      ? primary
      : [];
  }
  if (chunks.length === 0) return [];

  const byIndex = new Map<number, SupabaseSdkCookie>();
  for (const cookie of chunks) {
    const index = readableNames.indexOf(cookie.name) - 1;
    if (index < 0 || byIndex.has(index) || !cookie.value) return [];
    byIndex.set(index, cookie);
  }
  const maxIndex = Math.max(...byIndex.keys());
  if (byIndex.size !== maxIndex + 1) return [];
  if (
    chunks.reduce((total, cookie) => total + cookie.value.length, 0) >
    SUPABASE_SESSION_COOKIE_MAX_ENCODED_LENGTH
  ) {
    return [];
  }
  return requestCookies.filter((cookie) => byIndex.has(readableNames.indexOf(cookie.name) - 1));
}

function readableStorageNames(baseName: string): readonly string[] {
  return [
    baseName,
    ...Array.from(
      { length: SUPABASE_AUTH_COOKIE_READ_CHUNK_LIMIT },
      (_, index) => `${baseName}.${index}`,
    ),
  ];
}
