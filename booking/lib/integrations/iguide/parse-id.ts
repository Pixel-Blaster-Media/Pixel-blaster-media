/**
 * iGuide URL helpers.
 *
 * Two terms the API distinguishes that we also need to:
 *
 *   - **alias**   The mutable URL slug (e.g. `1044_rest_acres_rd_brant_on`).
 *                 Appears in public-facing URLs. Can change over time if the
 *                 tour is renamed. Stored on the booking as `iguide_id`.
 *
 *   - **portal id**  The immutable handle (e.g. `igYGFV5GG6V8DD1`). Issued
 *                 by iGuide and never changes. Required for Portal REST API
 *                 calls. Arrives on the ready-event webhook payload. Stored
 *                 on the booking as `iguide_portal_id`.
 *
 * Everything below operates on the alias because that's what we can derive
 * from a pasted URL. The portal id can only come from the webhook or the
 * Portal API, not from parsing a URL.
 */

/**
 * Normalize whatever the admin pasted into a clean alias.
 *
 * Accepted inputs:
 *   https://youriguide.com/1044_rest_acres_rd_brant_on/
 *   https://youriguide.com/1044_rest_acres_rd_brant_on/?page=tour
 *   https://unbranded.youriguide.com/1044_rest_acres_rd_brant_on/
 *   https://youriguide.com/embed/1044_rest_acres_rd_brant_on/
 *   youriguide.com/1044_rest_acres_rd_brant_on
 *   1044_rest_acres_rd_brant_on
 *
 * Returns null when the input doesn't look like a valid iGuide reference
 * (so callers can surface a friendly error rather than persisting garbage).
 */

const ALIAS_RE = /^[a-z0-9_\-]{3,128}$/i;

// Matches the public-facing iGuide hosts — standard (youriguide.com) and
// the unbranded subdomain. We don't currently route photos-only / radix
// traffic to the booking site, so leave those out for now.
const HOST_RE = /(^|\.)youriguide\.com$/i;

export function parseIGuideAlias(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare alias — fast path. iGuide aliases are case-sensitive on their
  // side (e.g. `9_212_stonehenge_dr_Ancaster_on` will 404 if you
  // normalize to lowercase), so we preserve the exact case as given.
  if (ALIAS_RE.test(trimmed)) return trimmed;

  let candidate = trimmed;

  // Tolerate copy-pasted URLs with or without scheme.
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (!HOST_RE.test(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  // youriguide.com/embed/<alias>/ — the embed URL tucks the alias behind
  // an `embed` segment. Peel it off.
  const first =
    segments[0] === "embed" && segments.length >= 2 ? segments[1] : segments[0];
  if (!first || !ALIAS_RE.test(first)) return null;
  return first;
}

/** Public branded viewer URL. */
export function iguideViewerUrl(alias: string): string {
  return `https://youriguide.com/${alias}/`;
}

/**
 * Unbranded viewer URL — preferred for embedding inside our realtor
 * portal so the realtor sees no other agent's branding. Lives on a
 * separate subdomain, not a `?ub=1` query param.
 */
export function iguideUnbrandedUrl(alias: string): string {
  return `https://unbranded.youriguide.com/${alias}/`;
}

/**
 * iGuide's embed-optimized viewer URL — tuned for iframes (adjusts
 * layout for constrained viewports, sets the embedded flag). Prefer
 * this over the viewer URL when embedding.
 */
export function iguideEmbedUrl(alias: string): string {
  return `https://youriguide.com/embed/${alias}/`;
}

/** Imperial floor plan PDF URL — public, no token required. */
export function iguideFloorplanPdfUrl(alias: string): string {
  return `https://youriguide.com/${alias}/doc/floorplan_imperial_en.pdf`;
}

/** Metric floor plan PDF URL — public, no token required. */
export function iguideFloorplanMetricPdfUrl(alias: string): string {
  return `https://youriguide.com/${alias}/doc/floorplan_metric_en.pdf`;
}

/**
 * RESO-compliant autofill endpoint. Publicly readable per-tour — useful
 * as a fallback when we only know the alias (e.g. admin pasted a URL
 * but the tour hasn't fired its ready webhook yet, so we don't have
 * the Portal ID).
 */
export function iguideRESOAutofillUrl(alias: string): string {
  return `https://youriguide.com/${alias}/reso/autofill`;
}

/** iframe embed snippet for a tour — drop into the realtor portal as-is. */
export function iguideEmbedHtml(alias: string): string {
  const url = iguideEmbedUrl(alias);
  return `<iframe src="${url}" width="100%" height="600" frameborder="0" allowfullscreen loading="lazy" title="iGuide virtual tour"></iframe>`;
}
