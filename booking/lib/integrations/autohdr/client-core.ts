import {
  buildAutoHDRCreateRequest,
  parseAutoHDRCreateResponse,
  parseAutoHDRProcessedPhotos,
  parseAutoHDRStatusResponse,
  type AutoHDRStyleInput,
} from "./contract.ts";

const BASE_URL = "https://quantumreachadvertising.com/external-api/v2/";
const MAX_JSON_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

export async function resolveAutoHDRClient(input: {
  organizationId: string;
  getCredential: (
    provider: "autohdr",
    field: "api_key",
    envVar: "AUTOHDR_API_KEY",
    organizationId: string,
  ) => Promise<string | null>;
  fetchImpl?: FetchLike;
}) {
  const apiKey = await input.getCredential(
    "autohdr",
    "api_key",
    "AUTOHDR_API_KEY",
    input.organizationId,
  );
  if (!apiKey) {
    throw new Error(
      "AutoHDR API key is not configured. Save it under Settings → Connections.",
    );
  }
  return createAutoHDRClient({ apiKey, fetchImpl: input.fetchImpl });
}

export class AutoHDRRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function createAutoHDRClient(input: {
  apiKey: string;
  fetchImpl?: FetchLike;
}) {
  const apiKey = normalizeApiKey(input.apiKey);
  const fetchImpl = input.fetchImpl ?? fetch;

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetchImpl(new URL(path, BASE_URL), {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) {
      await discardBounded(response);
      throw new AutoHDRRequestError(
        `AutoHDR request failed (${response.status}).`,
        response.status,
      );
    }
    return readBoundedJson(response);
  }

  return {
    async createPhotoshoot(createInput: {
      files: string[];
      uploadCallbackUrl: string;
      statusCallbackUrl?: string;
      address?: string;
      style?: AutoHDRStyleInput;
      mockCall?: boolean;
    }) {
      const value = await request("create-photoshoot-with-presigned-urls", {
        method: "POST",
        body: JSON.stringify(buildAutoHDRCreateRequest(createInput)),
      });
      return parseAutoHDRCreateResponse(value);
    },

    async finalizePhotoshoot(uid: string, mockCall = false) {
      const safeUid = validatedUid(uid);
      const value = await request("finalize-photoshoot-upload", {
        method: "POST",
        body: JSON.stringify({ uid: safeUid, ...(mockCall ? { mock_call: true } : {}) }),
      });
      return parseAutoHDRCreateResponse(value);
    },

    async getStatus(uid: string) {
      const value = await request(
        `get-photoshoot-status/${encodeURIComponent(validatedUid(uid))}`,
      );
      return parseAutoHDRStatusResponse(value);
    },

    async getProcessedPhotos(uid: string) {
      const value = await request(
        `get-processed-photos/${encodeURIComponent(validatedUid(uid))}`,
      );
      return parseAutoHDRProcessedPhotos(value);
    },
  };
}

function normalizeApiKey(value: string): string {
  if (typeof value !== "string") throw new Error("AutoHDR API key is required.");
  const key = value.trim().replace(/^Bearer\s+/i, "");
  if (!key || key.length > 4096 || /[\r\n\u0000]/.test(key)) {
    throw new Error("AutoHDR API key is invalid.");
  }
  return key;
}

function validatedUid(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/.test(value)) {
    throw new Error("AutoHDR uid is invalid.");
  }
  return value;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType && contentType !== "application/json") {
    throw new AutoHDRRequestError("AutoHDR returned an unexpected response type.", 502);
  }
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_JSON_BYTES)) {
    throw new AutoHDRRequestError("AutoHDR returned an oversized response.", 502);
  }
  const bytes = await readBounded(response, MAX_JSON_BYTES);
  if (!bytes.byteLength) {
    throw new AutoHDRRequestError("AutoHDR returned an empty response.", 502);
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AutoHDRRequestError("AutoHDR returned invalid JSON.", 502);
  }
}

async function discardBounded(response: Response): Promise<void> {
  await readBounded(response, 8192).catch(() => undefined);
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AutoHDRRequestError("AutoHDR returned an oversized response.", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
