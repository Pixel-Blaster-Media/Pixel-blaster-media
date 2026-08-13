const MAX_CALLBACK_BYTES = 16 * 1024;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_CALLBACK_BYTES)) {
    return new Response(null, { status: 413 });
  }

  if (request.body) {
    const reader = request.body.getReader();
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_CALLBACK_BYTES) {
          await reader.cancel();
          return new Response(null, { status: 413 });
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // AutoHDR's callback authentication and payload schema are not documented.
  // Treat this only as an availability acknowledgement. Authenticated outbound
  // polling remains the sole authority for durable provider state changes.
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
