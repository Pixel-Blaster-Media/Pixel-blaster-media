import type { Json } from "@/lib/supabase/database.types";

export function metadataImageUrls(metadata: Json | null | undefined): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }
  const value = metadata.image_urls;
  if (!Array.isArray(value)) return [];
  return uniqueImageUrls(
    value.filter((item): item is string => typeof item === "string"),
  );
}

export function imageUrlOrNull(url: string | null | undefined): string | null {
  return url && isDisplayableImageUrl(url) ? url : null;
}

export function uniqueImageUrls(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || !isDisplayableImageUrl(value) || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function isDisplayableImageUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.toLowerCase();
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (/\.(avif|gif|jpe?g|png|webp)$/.test(pathname)) return true;

    const hostname = parsed.hostname.toLowerCase();
    const isYourIGuide =
      hostname === "youriguide.com" || hostname.endsWith(".youriguide.com");
    return isYourIGuide && pathname.includes("/doc/") && pathname.endsWith(".image");
  } catch {
    return false;
  }
}
