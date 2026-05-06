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

  const safeUrl = parseSafeIGuidePdfUrl(rawUrl);
  if (!safeUrl) {
    return new NextResponse("Unsupported download URL.", { status: 400 });
  }

  const upstream = await fetch(safeUrl, {
    headers: { Accept: "application/pdf" },
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("File unavailable.", { status: upstream.status });
  }

  const filename = safeUrl.pathname.split("/").pop() || "iguide.pdf";
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

function parseSafeIGuidePdfUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.hostname !== "youriguide.com") return null;
  if (!url.pathname.includes("/doc/")) return null;
  if (!url.pathname.toLowerCase().endsWith(".pdf")) return null;
  return url;
}
