import { AutoHDRWorkflowError } from "./application-core.ts";

const MAX_BODY_BYTES = 96 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function readBoundedAutoHDRJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new AutoHDRWorkflowError("invalid_request", "AutoHDR request is too large.", 413);
  }
  if (!request.body) throw new AutoHDRWorkflowError("invalid_request", "AutoHDR request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new AutoHDRWorkflowError("invalid_request", "AutoHDR request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AutoHDRWorkflowError("invalid_request", "AutoHDR request body must be valid JSON.");
  }
}

export function parseAutoHDRPrepareInput(value: unknown): {
  manifest: Array<{ name: unknown; size: unknown; lastModified: unknown }>;
  style: unknown;
} {
  const row = exactObject(value, ["manifest", "style"]);
  if (!Array.isArray(row.manifest)) {
    throw new AutoHDRWorkflowError("invalid_request", "AutoHDR manifest must be an array.");
  }
  const manifest = row.manifest.map((entry) => {
    const item = exactObject(entry, ["name", "size", "lastModified"]);
    return { name: item.name, size: item.size, lastModified: item.lastModified };
  });
  return { manifest, style: row.style };
}

export function parseAutoHDRJobOnlyInput(value: unknown): { jobId: string } {
  const row = exactObject(value, ["jobId"]);
  if (typeof row.jobId !== "string" || !UUID.test(row.jobId)) {
    throw new AutoHDRWorkflowError("invalid_request", "AutoHDR job ID is invalid.");
  }
  return { jobId: row.jobId };
}

export function toAutoHDRRouteError(error: unknown): {
  status: number;
  body: { ok: false; error: string; code: string };
} {
  if (error instanceof AutoHDRWorkflowError) {
    return { status: error.status, body: { ok: false, error: error.message, code: error.code } };
  }
  return {
    status: 500,
    body: {
      ok: false,
      error: "AutoHDR request could not be completed.",
      code: "autohdr_unavailable",
    },
  };
}

function exactObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AutoHDRWorkflowError("invalid_request", "AutoHDR request must be an object.");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new AutoHDRWorkflowError("invalid_request", "AutoHDR request fields are invalid.");
  }
  return row;
}
