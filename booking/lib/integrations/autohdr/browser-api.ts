const MAX_AUTOHDR_RESPONSE_BYTES = 64 * 1024;

export async function readAutoHDRApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type")?.toLowerCase().split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    throw new Error("AutoHDR returned an unexpected response.");
  }
  if (!response.body) throw new Error("AutoHDR returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUTOHDR_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("AutoHDR response was too large.");
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
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("AutoHDR returned invalid JSON.");
  }
  if (!response.ok) {
    const error = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).error
      : null;
    throw new Error(typeof error === "string" && error.length <= 500
      ? error
      : `AutoHDR request failed (${response.status}).`);
  }
  return value as T;
}
