import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth/require-user";
import {
  getAssetUrls,
  getReadyEventObject,
  type IGuideMediaUrls,
} from "@/lib/integrations/iguide/portal-client";
import { parseIGuideAlias } from "@/lib/integrations/iguide/parse-id";
import { isIGuidePhotoZipUrl } from "@/lib/integrations/iguide/photo-downloads";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOWNLOAD_TIMEOUT_MS = 30_000;

interface IGuideBookingRow {
  id: string;
  organization_id: string;
  iguide_id: string | null;
  iguide_portal_id: string | null;
}

interface IGuideJobRow {
  work_order_id: string | null;
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req.nextUrl.pathname);

  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return new NextResponse("Missing URL.", { status: 400 });
  }

  const safeUrl = parseSafeIGuideDownloadUrl(rawUrl);
  const alias = safeUrl ? parseIGuideAlias(safeUrl.toString()) : null;
  if (!safeUrl || !alias) {
    return new NextResponse("Unsupported download URL.", { status: 400 });
  }

  // The raw URL is user-controlled. Confirm this signed-in user can read a
  // booking linked to the alias before the server fetches any iGUIDE file.
  const supabase = await getServerSupabase();
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, organization_id, iguide_id, iguide_portal_id")
    .eq("organization_id", user.organizationId)
    .eq("iguide_id", alias)
    .maybeSingle<IGuideBookingRow>();

  if (bookingError) {
    console.error("[iguide.download] booking authorization failed", bookingError);
    return new NextResponse("Could not authorize this download.", { status: 500 });
  }
  if (!booking) {
    return new NextResponse("This file is not part of your listing.", { status: 403 });
  }

  let downloadUrl = safeUrl;
  let refreshed = false;

  // Gallery ZIP access tokens expire after three weeks. Refresh before the
  // first request when no token is present, and retry once on an expired token.
  if (isPrivateIGuideDocument(downloadUrl) && !downloadUrl.searchParams.has("accessToken")) {
    const fresh = await refreshIGuideDownloadUrl(downloadUrl, booking);
    if (fresh) {
      downloadUrl = fresh;
      refreshed = true;
    }
  }

  let upstream = await fetchIGuideDownload(downloadUrl);
  if (
    (upstream.status === 401 || upstream.status === 403) &&
    booking.iguide_portal_id &&
    !refreshed
  ) {
    const fresh = await refreshIGuideDownloadUrl(downloadUrl, booking);
    if (fresh) {
      downloadUrl = fresh;
      upstream = await fetchIGuideDownload(downloadUrl);
    }
  }

  if (!upstream.ok || !upstream.body) {
    return new NextResponse("File unavailable. Ask the photographer to sync iGUIDE again.", {
      status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFilename(downloadUrl)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function fetchIGuideDownload(url: URL): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { Accept: "*/*" },
      cache: "no-store",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}

async function refreshIGuideDownloadUrl(
  requestedUrl: URL,
  booking: IGuideBookingRow,
): Promise<URL | null> {
  const portalId = booking.iguide_portal_id;
  if (!portalId) return null;

  const [assets, jobResult] = await Promise.all([
    getAssetUrls(portalId, { organizationId: booking.organization_id }),
    getServiceSupabase()
      .from("iguide_jobs")
      .select("work_order_id")
      .eq("organization_id", booking.organization_id)
      .eq("booking_id", booking.id)
      .eq("iguide_id", portalId)
      .maybeSingle<IGuideJobRow>(),
  ]);

  const assetMedia = assets.ok ? pickPreferredMedia(assets.data?.languages) : {};
  let candidate = matchingAssetUrl(requestedUrl, assetMedia);
  let accessToken: string | null = null;

  const workOrderId = jobResult.data?.work_order_id;
  if (workOrderId) {
    const ready = await getReadyEventObject(portalId, workOrderId, {
      organizationId: booking.organization_id,
    });
    if (ready.ok && ready.data) {
      accessToken = usableAccessToken(ready.data.authtoken);
      candidate ??= matchingAssetUrl(
        requestedUrl,
        pickPreferredMedia(ready.data.urls?.mediaUrls),
      );
    }
  }

  const parsed = candidate ? parseSafeIGuideDownloadUrl(candidate) : null;
  if (!parsed) return null;
  if (
    accessToken &&
    isPrivateIGuideDocument(parsed) &&
    !parsed.searchParams.has("accessToken")
  ) {
    parsed.searchParams.set("accessToken", accessToken);
  }
  return parsed;
}

function pickPreferredMedia(
  languages: Record<string, IGuideMediaUrls | undefined> | undefined,
): IGuideMediaUrls {
  if (!languages) return {};
  return (
    languages.en ??
    Object.values(languages).find((media): media is IGuideMediaUrls => !!media) ??
    {}
  );
}

function matchingAssetUrl(requestedUrl: URL, media: IGuideMediaUrls): string | null {
  if (isIGuidePhotoZipUrl(requestedUrl.toString(), "mls")) {
    return media.galleryMlsZip ?? media.galleryLowResZip ?? media.galleryLowRes ?? null;
  }
  if (isIGuidePhotoZipUrl(requestedUrl.toString(), "high_res")) {
    return media.galleryZip ?? null;
  }

  const pathname = requestedUrl.pathname.toLowerCase();
  if (pathname.includes("floorplan_imperial")) return media.pdfImperial ?? null;
  if (pathname.includes("floorplan_metric")) return media.pdfMetric ?? null;
  return null;
}

function usableAccessToken(value: string | null | undefined): string | null {
  if (!value || value === "[redacted]") return null;
  return value;
}

function isPrivateIGuideDocument(url: URL): boolean {
  const pathname = url.pathname.toLowerCase();
  return pathname.endsWith(".zip") || /\/floor_(?:metric|imperial).*\.jpe?g$/.test(pathname);
}

function parseSafeIGuideDownloadUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.hostname !== "youriguide.com") return null;
  if (!url.pathname.includes("/doc/")) return null;
  if (!isSupportedIGuideDownloadPath(url.pathname)) return null;
  return url;
}

function isSupportedIGuideDownloadPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return (
    lower.endsWith(".pdf") ||
    lower.endsWith(".zip") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".image")
  );
}

function safeFilename(url: URL): string {
  const encoded = url.pathname.split("/").pop() || "iguide-download";
  let decoded = encoded;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    // Keep the encoded path segment when it is not valid percent-encoding.
  }
  return decoded.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180) || "iguide-download";
}
