export type IGuidePhotoZipKind = "mls" | "high_res";

export function isIGuidePhotoZipUrl(
  rawUrl: string | null | undefined,
  kind?: IGuidePhotoZipKind,
): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.toLowerCase();
    const isYourIGuide =
      parsed.hostname === "youriguide.com" ||
      parsed.hostname.endsWith(".youriguide.com");

    return (
      parsed.protocol === "https:" &&
      isYourIGuide &&
      pathname.includes("/doc/") &&
      matchesIGuidePhotoZipPath(pathname, kind)
    );
  } catch {
    return false;
  }
}

function matchesIGuidePhotoZipPath(
  pathname: string,
  kind?: IGuidePhotoZipKind,
): boolean {
  if (kind === "mls") {
    return /\/gallery-low-res(?:_[a-z]{2})?\.zip$/.test(pathname);
  }
  if (kind === "high_res") {
    return /\/gallery(?:_[a-z]{2})?\.zip$/.test(pathname);
  }
  return /\/gallery(?:-low-res)?(?:_[a-z]{2})?\.zip$/.test(pathname);
}
