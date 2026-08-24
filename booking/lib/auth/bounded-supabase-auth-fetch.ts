const DEFAULT_AUTH_TIMEOUT_MS = 5_000;
const DEFAULT_AUTH_RESPONSE_BYTES = 65_536;

interface BoundedAuthFetchOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
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
 * Wraps only Supabase's public `/auth/v1/user` verifier. Other Supabase traffic
 * retains its original fetch behavior, while authentication proof gets a hard
 * end-to-end deadline and a decompressed streamed-byte response ceiling.
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
    if (
      url.origin !== expectedOrigin ||
      url.pathname !== "/auth/v1/user"
    ) {
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
      const bytes = await readBoundedBytes(
        response,
        maxResponseBytes,
        controller.signal,
      );
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      if (controller.signal.aborted) throw abortFailure();
      throw error;
    } finally {
      clearTimeout(timeout);
      sourceSignal?.removeEventListener("abort", forwardAbort);
    }
  };
}
