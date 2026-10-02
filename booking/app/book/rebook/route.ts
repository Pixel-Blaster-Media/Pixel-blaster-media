import { NextResponse, type NextRequest } from "next/server";
import { startSimilarBooking } from "@/lib/booking/rebook";
import { configuredCanonicalOrigin, publicRedirectOrigin } from "@/lib/security/canonical-app-origin";
import { verifyProductionProxyRequest } from "@/lib/security/production-proxy-attestation";
import { isSameOriginRequest } from "@/lib/security/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explicit owner-checked POST under the draft cookie's /book path. GET never
 * creates a draft. Production middleware enforces the canonical proxy origin. */
export async function POST(request: NextRequest) {
  const productionProxyHost = process.env.BOOKING_PROXY_UPSTREAM_HOST ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const trustedProductionProxy = await verifyProductionProxyRequest(request, process.env.BOOKING_PROXY_SHARED_SECRET, {
    canonicalHost: configuredCanonicalOrigin().hostname, productionProxyHost,
  });
  if (!isSameOriginRequest(request.headers.get("origin"), request.url, {
    host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"), productionProxyHost, trustedProductionProxy,
  })) {
    return new NextResponse("Cross-origin request rejected.", { status: 403 });
  }
  // Next may expose an internal hostname in request.url. Use the verified
  // external origin locally; production always redirects to the canonical site.
  const origin = process.env.VERCEL_ENV === "production"
    ? publicRedirectOrigin(request.url) : new URL(request.headers.get("origin")!);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return new NextResponse("Unsupported form encoding.", { status: 415 });
  }
  const reader = request.body?.getReader();
  if (!reader) return new NextResponse("Invalid form.", { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        return new NextResponse("Form is too large.", { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return new NextResponse("Invalid form.", { status: 400 });
  } finally { reader.releaseLock(); }
  const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  if ([...params.keys()].some(key => !["property_id", "booking_id"].includes(key)) ||
      params.getAll("property_id").length !== 1 || params.getAll("booking_id").length > 1) {
    return new NextResponse("Invalid form.", { status: 400 });
  }
  const form = new FormData();
  for (const [key, value] of params) form.set(key, value);
  const result = await startSimilarBooking(form);
  if ("href" in result) {
    return NextResponse.redirect(new URL(result.href, origin), 303);
  }
  const retry = new URLSearchParams({ from_property: params.get("property_id")!, rebook_error: "draft_unavailable" });
  if (params.get("booking_id")) retry.set("from_booking", params.get("booking_id")!);
  return NextResponse.redirect(new URL(`/portal/book?${retry}`, origin), 303);
}
