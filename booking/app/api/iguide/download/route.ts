import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await requireUser();

  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return new NextResponse("Missing URL.", { status: 400 });
  }

  const safeUrl = parseSafeIGuideDownloadUrl(rawUrl);
  if (!safeUrl) {
    return new NextResponse("Unsupported download URL.", { status: 400 });
  }

  const upstream = await fetch(safeUrl, {
    headers: { Accept: "*/*" },
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("File unavailable.", { status: upstream.status });
  }

  const filename = safeUrl.pathname.split("/").pop() || "iguide-download";
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replaceAll('"', "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
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
