export interface RefreshedSessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export type RefreshExchangeResult =
  | { ok: true; tokens: RefreshedSessionTokens }
  | { ok: false; kind: "invalid" | "unavailable" | "malformed" };

export interface RefreshExchangeOptions {
  supabaseUrl: string | undefined;
  anonKey: string | undefined;
  fetcher?: (
    input: string | URL,
    init?: RequestInit,
  ) => Promise<Response>;
}

const MAX_TOKEN_LENGTH = 16_384;
const MAX_PROVIDER_RESPONSE_BYTES = 65_536;

/**
 * Prove an opaque refresh token to Supabase Auth and receive its rotated pair.
 * Provider response bodies and transport errors intentionally remain opaque.
 */
export async function exchangeSupabaseRefreshToken(
  refreshToken: string,
  options: RefreshExchangeOptions,
): Promise<RefreshExchangeResult> {
  if (
    typeof refreshToken !== "string" ||
    refreshToken.length === 0 ||
    refreshToken.length > MAX_TOKEN_LENGTH
  ) {
    return { ok: false, kind: "invalid" };
  }
  if (!options.supabaseUrl || !options.anonKey) {
    return { ok: false, kind: "unavailable" };
  }

  let endpoint: URL;
  try {
    endpoint = new URL(
      "/auth/v1/token?grant_type=refresh_token",
      options.supabaseUrl,
    );
    if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
      return { ok: false, kind: "unavailable" };
    }
  } catch {
    return { ok: false, kind: "unavailable" };
  }

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        apikey: options.anonKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, kind: "unavailable" };
  }

  if (!response.ok) {
    return {
      ok: false,
      kind:
        response.status >= 400 && response.status < 500 && response.status !== 429
          ? "invalid"
          : "unavailable",
    };
  }

  const parsedResponse = await readBoundedProviderJson(
    response,
    MAX_PROVIDER_RESPONSE_BYTES,
  );
  if (!parsedResponse.ok) {
    return { ok: false, kind: "malformed" };
  }
  const value = parsedResponse.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, kind: "malformed" };
  }

  const record = value as Record<string, unknown>;
  const tokenType = record.token_type;
  if (
    typeof record.access_token !== "string" ||
    record.access_token.length === 0 ||
    record.access_token.length > MAX_TOKEN_LENGTH ||
    typeof record.refresh_token !== "string" ||
    record.refresh_token.length === 0 ||
    record.refresh_token.length > MAX_TOKEN_LENGTH ||
    typeof record.expires_in !== "number" ||
    !Number.isFinite(record.expires_in) ||
    record.expires_in <= 0 ||
    (tokenType !== undefined && typeof tokenType !== "string")
  ) {
    return { ok: false, kind: "malformed" };
  }

  const safeTokenType = typeof tokenType === "string" ? tokenType : "bearer";
  return {
    ok: true,
    tokens: {
      access_token: record.access_token,
      refresh_token: record.refresh_token,
      expires_in: record.expires_in,
      token_type: safeTokenType,
    },
  };
}

async function readBoundedProviderJson(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") return { ok: false };

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { ok: false };
    }
  }
  if (!response.body) return { ok: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
