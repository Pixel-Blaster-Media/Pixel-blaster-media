import data from "./website-galleries.generated.json";

export interface WebsiteGalleryPhoto {
  id: string;
  alt: string;
  width: number;
  height: number;
  src: string;
  srcSet: string;
}
export interface WebsiteGallery {
  slug: string;
  label: string;
  title: string;
  description: string;
  url: string;
  count: number;
  sections: { title: string; photos: WebsiteGalleryPhoto[] }[];
}

export const WEBSITE_GALLERIES: readonly WebsiteGallery[] = Object.values(data);

/** Only our six public collection links gain an on-page gallery. Other links retain their behavior. */
export function websiteGallery(raw: string | null): WebsiteGallery | undefined {
  if (!raw || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search
      || !["pixelblastermedia.com", "www.pixelblastermedia.com"].includes(url.hostname)
      || url.pathname !== "/") return undefined;
    return WEBSITE_GALLERIES.find(gallery => url.hash === `#gallery/${gallery.slug}`);
  } catch { return undefined; }
}
