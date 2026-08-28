import type {
  SupabaseAuthUserProof,
  SupabaseRefreshTokenCandidate,
} from "./supabase-refresh-cookie-transaction.ts";

const DEFAULT_AUTH_TIMEOUT_MS = 5_000;
const DEFAULT_AUTH_RESPONSE_BYTES = 65_536;
const MAX_REFRESH_TOKEN_BYTES = 16_384;

interface BoundedAuthFetchOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  onTokenExchangeFailure?: (kind: "unavailable" | "terminal") => void;
  onTokenExchangeSuccess?: () => void;
  onRefreshTokenCandidate?: (candidate: SupabaseRefreshTokenCandidate) => void;
  onAuthUserProof?: (proof: SupabaseAuthUserProof) => boolean | void;
}

type FetchImplementation = typeof globalThis.fetch;

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function inputUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function abortFailure(): Error {
  return new Error("Authentication verification request failed.");
}

function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortFailure());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortFailure());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function readBoundedBytes(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxResponseBytes) {
      throw new Error("Authentication verification response is too large.");
    }
  }
  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await raceWithAbort(reader.read(), signal);
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxResponseBytes) {
        throw new Error("Authentication verification response is too large.");
      }
      chunks.push(result.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }

  const buffer = new ArrayBuffer(totalBytes);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

/**
 * Wraps only the same-origin authoritative user lookup and refresh-token
 * exchange used by server request authentication. Other Supabase Auth and
 * PostgREST operations retain their original fetch behavior.
 */
export function createBoundedSupabaseAuthFetch(
  supabaseUrl: string,
  fetchImplementation: FetchImplementation = globalThis.fetch,
  options: BoundedAuthFetchOptions = {},
): FetchImplementation {
  const expectedOrigin = new URL(supabaseUrl).origin;
  const timeoutMs = positiveSafeInteger(
    options.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS,
    "timeoutMs",
  );
  const maxResponseBytes = positiveSafeInteger(
    options.maxResponseBytes ?? DEFAULT_AUTH_RESPONSE_BYTES,
    "maxResponseBytes",
  );

  return async (input, init) => {
    const url = inputUrl(input);
    const tokenEndpoint = url.pathname === "/auth/v1/token";
    const refreshTokenExchange =
      tokenEndpoint && url.searchParams.get("grant_type") === "refresh_token";
    const authUserEndpoint = url.pathname === "/auth/v1/user";
    const boundedAuthPath = authUserEndpoint || refreshTokenExchange;
    if (url.origin !== expectedOrigin || !boundedAuthPath) {
      return fetchImplementation(input, init);
    }

    const controller = new AbortController();
    const sourceSignal = init?.signal ??
      (input instanceof Request ? input.signal : undefined);
    const forwardAbort = () => controller.abort();
    if (sourceSignal?.aborted) controller.abort();
    else sourceSignal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await raceWithAbort(
        fetchImplementation(input, { ...init, signal: controller.signal }),
        controller.signal,
      );
      const responseHasBody = response.body !== null;
      const bytes = await readBoundedBytes(
        response,
        maxResponseBytes,
        controller.signal,
      );
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      if (!response.ok) {
        const unavailable = isUnavailableStatus(response.status);
        if (refreshTokenExchange) {
          options.onTokenExchangeFailure?.(
            unavailable ? "unavailable" : "terminal",
          );
        }
        if (authUserEndpoint) {
          options.onAuthUserProof?.({
            accessToken: bearerAccessToken(input, init),
            bytes,
            ok: false,
          });
        }
        return sanitizedAuthFailureResponse(
          refreshTokenExchange && unavailable ? 500 : response.status,
          unavailable,
          tokenEndpoint,
        );
      }
      const tokenCandidate = tokenEndpoint
        ? parseTokenExchangeResponse(bytes)
        : null;
      if (tokenEndpoint && !tokenCandidate) {
        // auth-js retries malformed successful refresh responses for an entire
        // auto-refresh tick and can then delete the still-recoverable cookie.
        // Convert malformed 2xx responses into one sanitized, non-retryable
        // availability error before auth-js can parse or amplify them.
        if (refreshTokenExchange) {
          options.onTokenExchangeFailure?.("unavailable");
        }
        return sanitizedAuthFailureResponse(400, true, true);
      }
      if (refreshTokenExchange && tokenCandidate) {
        options.onRefreshTokenCandidate?.(tokenCandidate);
        options.onTokenExchangeSuccess?.();
      }
      if (authUserEndpoint) {
        const accepted = options.onAuthUserProof?.({
          accessToken: bearerAccessToken(input, init),
          bytes,
          ok: true,
        });
        if (accepted === false) {
          return sanitizedAuthFailureResponse(500, true, false);
        }
      }
      // auth-js retries 502/503/504 refresh responses internally for an entire
      // auto-refresh tick. Normalize only token exchanges to a non-retryable
      // 500 while preserving fail-closed unavailable classification upstream.
      const status =
        refreshTokenExchange && [502, 503, 504].includes(response.status)
          ? 500
          : response.status;
      return new Response(responseHasBody ? bytes : null, {
        status,
        statusText:
          status === response.status ? response.statusText : "Internal Server Error",
        headers,
      });
    } catch (error) {
      if (refreshTokenExchange) {
        options.onTokenExchangeFailure?.("unavailable");
        return sanitizedAuthFailureResponse(500, true, true);
      }
      if (authUserEndpoint) {
        options.onAuthUserProof?.({
          accessToken: bearerAccessToken(input, init),
          bytes: null,
          ok: false,
        });
      }
      if (controller.signal.aborted) throw abortFailure();
      throw error;
    } finally {
      clearTimeout(timeout);
      sourceSignal?.removeEventListener("abort", forwardAbort);
    }
  };
}

function isUnavailableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseTokenExchangeResponse(
  bytes: ArrayBuffer,
): SupabaseRefreshTokenCandidate | null {
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const session = value as Record<string, unknown>;
    if (
      typeof session.access_token === "string" &&
      session.access_token.length > 0 &&
      session.access_token.length <= MAX_REFRESH_TOKEN_BYTES &&
      typeof session.refresh_token === "string" &&
      session.refresh_token.length > 0 &&
      session.refresh_token.length <= MAX_REFRESH_TOKEN_BYTES &&
      typeof session.token_type === "string" &&
      session.token_type.toLowerCase() === "bearer" &&
      Number.isSafeInteger(session.expires_in) &&
      (session.expires_in as number) > 0 &&
      Boolean(session.user) &&
      typeof session.user === "object" &&
      !Array.isArray(session.user)
    ) {
      const userId = (session.user as Record<string, unknown>).id;
      if (typeof userId !== "string" || userId.length === 0 || userId.length > 256) {
        return null;
      }
      return {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        userId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function bearerAccessToken(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): string | null {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  }
  const authorization = headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function sanitizedAuthFailureResponse(
  status: number,
  unavailable: boolean,
  tokenExchange: boolean,
): Response {
  return Response.json(
    unavailable
      ? {
          code: "auth_transport_unavailable",
          error_code: "auth_transport_unavailable",
          message: "Authentication service unavailable.",
        }
      : tokenExchange
        ? {
          code: "invalid_refresh_token",
          message: "Authentication session is invalid.",
        }
        : {
            code: "auth_request_rejected",
            message: "Authentication request was rejected.",
          },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
