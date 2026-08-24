export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      kind: "unsupported_media_type" | "too_large" | "invalid_json";
    };

/**
 * Reads JSON while enforcing the actual streamed byte count. A caller-supplied
 * Content-Length is only an early rejection hint and is never trusted as the
 * complete size boundary.
 */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer.");
  }

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, kind: "unsupported_media_type" };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { ok: false, kind: "too_large" };
    }
  }

  if (!request.body) return { ok: false, kind: "invalid_json" };

  const reader = request.body.getReader();
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
        return { ok: false, kind: "too_large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return { ok: false, kind: "invalid_json" };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, kind: "invalid_json" };
  }
}
