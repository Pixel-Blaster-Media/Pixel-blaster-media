import "server-only";

import { iguideRESOAutofillUrl } from "./parse-id";

/**
 * Read-only client for the iGuide RESO autofill endpoint.
 *
 * The RESO autofill response is publicly accessible per-view (no API key
 * required), so this is a thin fetch wrapper. The shape we model below is
 * the *subset of fields* we actually consume — RESO returns far more
 * (room dimensions, photos array, branded vs unbranded URLs, etc.). When
 * we need additional fields we extend this interface; the runtime will
 * tolerate the extra keys we don't model.
 */

export interface IGuideRESOMedia {
  MediaObjectID?: string;
  ResourceName?: string;
  MediaCategory?: string;
  MediaType?: string;
  MediaURL?: string;
  ImageHeight?: number;
  ImageWidth?: number;
  PreferredPhotoYN?: boolean;
}

export interface IGuideRESOResponse {
  // Address-ish fields we surface in the admin booking detail.
  StreetNumber?: string;
  StreetName?: string;
  City?: string;
  StateOrProvince?: string;
  PostalCode?: string;
  Country?: string;

  // Living-space measurements.
  AboveGradeInteriorArea?: number;
  AboveGradeExteriorArea?: number;
  BelowGradeInteriorArea?: number;
  BelowGradeExteriorArea?: number;
  AboveGradeFinishedArea?: number;
  LivingArea?: number;

  // The Media[] array contains floor plans, virtual tours, photos, etc.
  // Each entry has a MediaCategory we can switch on.
  Media?: IGuideRESOMedia[];
}

export interface IGuideFetchResult {
  ok: boolean;
  status: number;
  data?: IGuideRESOResponse;
  error?: string;
}

/**
 * Fetch the RESO autofill payload for one published iGuide view.
 *
 * - 404 means the iGuide ID doesn't exist (or isn't yet published).
 * - 5xx is treated as transient — caller may want to retry.
 * - We pass `cache: 'no-store'` so the admin "Sync" button always sees
 *   the freshest data, not whatever Vercel cached.
 */
export async function fetchIGuideRESO(
  iguideId: string,
): Promise<IGuideFetchResult> {
  const url = iguideRESOAutofillUrl(iguideId);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error:
        err instanceof Error ? err.message : "Network error fetching iGuide.",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error:
        res.status === 404
          ? `iGuide ID "${iguideId}" not found (or not yet published).`
          : `iGuide returned ${res.status}.`,
    };
  }

  let data: IGuideRESOResponse;
  try {
    data = (await res.json()) as IGuideRESOResponse;
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      error: "iGuide response wasn't valid JSON.",
    };
  }

  return { ok: true, status: res.status, data };
}

// ---- Media helpers ----

/**
 * Return the first media entry whose category roughly matches the given
 * keyword. RESO categories aren't strictly enumerated across providers,
 * so we use a case-insensitive contains check to be tolerant of e.g.
 * "Virtual Tour Branded" vs "VirtualTour".
 */
export function findMediaByCategory(
  media: IGuideRESOMedia[] | undefined,
  needle: string,
): IGuideRESOMedia | undefined {
  if (!media) return undefined;
  const lc = needle.toLowerCase();
  return media.find((m) =>
    [m.MediaCategory, m.ResourceName, m.MediaType]
      .filter((s): s is string => !!s)
      .some((s) => s.toLowerCase().includes(lc)),
  );
}

/** Format the address for display from the RESO autofill payload. */
export function formatRESOAddress(data: IGuideRESOResponse): string {
  const street = [data.StreetNumber, data.StreetName].filter(Boolean).join(" ");
  const cityProv = [data.City, data.StateOrProvince].filter(Boolean).join(", ");
  return [street, cityProv, data.PostalCode].filter(Boolean).join(" · ");
}
