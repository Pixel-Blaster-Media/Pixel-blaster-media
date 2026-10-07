/** Pure destination checks shared by the public viewer and admin photo form. */
export function sampleHref(raw: string | null): string | undefined {
  if (!raw || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return url.protocol === "https:" && !url.username && !url.password
      && host !== "localhost" && !/\.(?:localhost|local|internal)$/.test(host)
      && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && !host.includes(":")
      ? raw : undefined;
  } catch { return undefined; }
}

export function photoSampleHref(raw: string | null): string | undefined {
  const href = sampleHref(raw);
  if (!href) return undefined;
  const url = new URL(href);
  const raster = /\.(?:jpe?g|png|webp|avif|gif)$/i.test(url.pathname);
  // Cloudflare Images delivery URLs have account/image/variant segments, not extensions.
  const cloudflare = (url.hostname === "imagedelivery.net" && /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname))
    || /^\/cdn-cgi\/imagedelivery\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname);
  return !url.port && (raster || cloudflare) ? href : undefined;
}

export function iGuideSampleHref(raw: string | null): string | undefined {
  const href = sampleHref(raw);
  if (!href) return undefined;
  const url = new URL(href);
  return !url.port && /^(?:www\.)?youriguide\.com$/.test(url.hostname)
    && /^\/(?:embed\/)?[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? href : undefined;
}

/** Stream's domain restriction requires its player to remain inside our site. */
export function streamSampleHref(raw: string | null): string | undefined {
  const href = sampleHref(raw);
  if (!href) return undefined;
  const url = new URL(href);
  return !url.port && /^customer-[a-zA-Z0-9]+\.cloudflarestream\.com$/.test(url.hostname)
    && /^\/[a-f0-9]{32}\/iframe$/.test(url.pathname) && !url.search && !url.hash
    ? href : undefined;
}
