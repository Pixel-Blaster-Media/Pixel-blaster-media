import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  AutoenhanceError,
  fetchEnhancedImage,
} from "@/lib/integrations/autoenhance/client";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const admin = await requireAdmin();
  const { imageId } = await params;
  const format = normalizeFormat(request.nextUrl.searchParams.get("format"));
  try {
    const { response, warning } = await fetchEnhancedPreview(
      imageId,
      admin.organizationId,
      format,
    );
    const headers = new Headers();
    headers.set(
      "Content-Type",
      response.headers.get("Content-Type") ?? `image/${format}`,
    );
    headers.set(
      "Content-Disposition",
      `inline; filename="autoenhance-${imageId}.${format === "jpeg" ? "jpg" : format}"`,
    );
    if (warning) headers.set("X-Autoenhance-Test-Warning", warning);
    return new NextResponse(response.body, { status: 200, headers });
  } catch (err) {
    const message =
      err instanceof AutoenhanceError
        ? `Autoenhance returned ${err.status}. The image may still be processing.`
        : err instanceof Error
          ? err.message
          : "The enhanced image is not ready yet.";
    return new NextResponse(renderNotReadyPage(message), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

async function fetchEnhancedPreview(
  imageId: string,
  organizationId: string,
  format: "jpeg" | "png" | "webp" | "avif",
): Promise<{ response: Response; warning?: string }> {
  try {
    return {
      response: await fetchEnhancedImage(imageId, {
        organizationId,
        format,
        quality: 90,
      }),
    };
  } catch (err) {
    if (!(err instanceof AutoenhanceError) || err.status !== 402) throw err;
    try {
      return {
        response: await fetchEnhancedImage(imageId, {
          organizationId,
          format,
          quality: 90,
          devMode: true,
        }),
        warning: "dev-mode",
      };
    } catch {
      return {
        response: await fetchEnhancedImage(imageId, {
          organizationId,
          format,
          quality: 85,
          preview: true,
        }),
        warning: "preview-fallback",
      };
    }
  }
}

function normalizeFormat(value: string | null): "jpeg" | "png" | "webp" | "avif" {
  if (value === "png" || value === "webp" || value === "avif") return value;
  return "jpeg";
}



function renderNotReadyPage(message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Autoenhance preview not ready</title>
    <style>
      body {
        margin: 0;
        background: #f6f2ea;
        color: #26352d;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      section {
        width: min(560px, 100%);
        border: 1px solid #d8dfd2;
        border-radius: 24px;
        background: rgba(255,255,255,0.82);
        box-shadow: 0 20px 50px rgba(38, 53, 45, 0.12);
        padding: 28px;
      }
      p.label {
        margin: 0 0 10px;
        color: #3e7b57;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        color: #68756d;
        line-height: 1.55;
      }
      a {
        display: inline-flex;
        margin-top: 12px;
        border-radius: 999px;
        background: #3e7b57;
        color: white;
        padding: 10px 16px;
        text-decoration: none;
        font-weight: 700;
      }
      code {
        display: block;
        margin-top: 16px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        border: 1px solid #e4e0d6;
        border-radius: 14px;
        background: #fffaf1;
        color: #6d4d16;
        padding: 12px;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <p class="label">Autoenhance preview</p>
        <h1>The enhanced photo is not ready yet.</h1>
        <p>
          The upload can still be working on Autoenhance's side. Go back to the
          sandbox and use Refresh order in a minute or two.
        </p>
        <a href="/admin/autoenhance-test">Back to Autoenhance test</a>
        <code>${escapeHtml(message)}</code>
      </section>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
