/**
 * Normalize whatever the admin pasted into a clean iGuide ID.
 *
 * iGuide URLs look like:
 *   https://youriguide.com/1044_rest_acres_rd_brant_on/
 *   https://youriguide.com/1044_rest_acres_rd_brant_on/?page=tour
 *   youriguide.com/1044_rest_acres_rd_brant_on
 *   1044_rest_acres_rd_brant_on
 *
 * The iGuide ID is the first path segment after the host. We tolerate
 * trailing slashes, query strings, and bare IDs pasted on their own.
 *
 * Returns null when the input doesn't look like a valid iGuide
 * reference at all (so callers can surface a friendly error rather than
 * persisting garbage).
 */

const ID_RE = /^[a-z0-9_\-]{3,128}$/i;

export function parseIGuideId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare ID — fast path.
  if (ID_RE.test(trimmed)) return trimmed.toLowerCase();

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

  if (!/youriguide\.com$/i.test(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (!first || !ID_RE.test(first)) return null;
  return first.toLowerCase();
}

/** Public branded URL for the tour, given the ID. */
export function iguideViewerUrl(id: string): string {
  return `https://youriguide.com/${id}/`;
}

/** Public unbranded viewer URL — preferred for embedding inside the realtor portal. */
export function iguideUnbrandedUrl(id: string): string {
  return `https://youriguide.com/${id}/?ub=1`;
}

/** Imperial floor plan PDF URL (English). */
export function iguideFloorplanPdfUrl(id: string): string {
  return `https://youriguide.com/${id}/doc/floorplan_imperial_en.pdf`;
}

/** RESO-compliant autofill endpoint — the source of truth we read on sync. */
export function iguideRESOAutofillUrl(id: string): string {
  return `https://youriguide.com/${id}/reso/autofill`;
}

/** iframe embed snippet for a tour — drop into the realtor portal as-is. */
export function iguideEmbedHtml(id: string): string {
  const url = iguideUnbrandedUrl(id);
  return `<iframe src="${url}" width="100%" height="600" frameborder="0" allowfullscreen loading="lazy" title="iGuide virtual tour"></iframe>`;
}
