/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  buildDeliveryLinks,
  isStreamingVideoUrl,
  metadataString,
  type DeliveryLink,
} from "@/lib/booking/delivery-links";
import {
  imageUrlOrNull,
  metadataImageUrls,
  uniqueImageUrls,
} from "@/lib/booking/media-images";
import {
  iguideEmbedUrl,
  parseIGuideAlias,
} from "@/lib/integrations/iguide/parse-id";
import { getServiceSupabase } from "@/lib/supabase/server";
import type {
  DeliverableSource,
  DeliverableType,
  Json,
  ListingWebsiteTemplate,
} from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

interface ListingWebsiteRow {
  property_id: string;
  booking_id: string | null;
  owner_id: string;
  template: ListingWebsiteTemplate;
  slug: string;
  is_published: boolean;
  headline: string | null;
  description: string | null;
  feature_bullets: string[];
  included_sections: string[];
  gallery_image_urls: string[] | null;
  hero_image_url: string | null;
  agent_name: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  brokerage_name: string | null;
  cta_text: string | null;
  cta_url: string | null;
}

interface PropertyRow {
  id: string;
  street_address: string;
  city: string | null;
  province: string | null;
  postal_code: string | null;
}

interface DeliverableRow {
  id: string;
  type: DeliverableType;
  source: DeliverableSource;
  url: string;
  thumbnail_url: string | null;
  metadata: Json | null;
  ready_at: string | null;
  created_at: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = await loadListing(slug);
  if (!listing || !listing.website.is_published) {
    return { title: "Listing not public" };
  }
  const title =
    listing.website.headline ?? listing.property.street_address ?? "Listing";
  return {
    title,
    description: listing.website.description ?? undefined,
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description: listing.website.description ?? undefined,
      images: listing.heroImage ? [{ url: listing.heroImage }] : undefined,
    },
  };
}

export default async function PublicListingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const listing = await loadListing(slug);

  if (!listing) notFound();
  if (!listing.website.is_published) {
    return (
      <div className="relative left-1/2 -mx-[50vw] -my-12 grid min-h-[70vh] w-screen place-items-center bg-[#f7f4ed] px-6 py-20 text-[#23332b]">
        <div className="max-w-md rounded-3xl border border-[#315f45]/15 bg-white/80 p-8 text-center shadow-xl shadow-[#23332b]/10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#315f45]">
            Private listing
          </p>
          <h1 className="mt-3 text-2xl font-semibold">
            This listing is not currently public.
          </h1>
          <p className="mt-2 text-sm text-[#6f7a70]">
            The agent or photographer can publish it when the page is ready to
            share.
          </p>
        </div>
      </div>
    );
  }

  const Template = TEMPLATE_COMPONENTS[listing.website.template];
  return <Template listing={listing} />;
}

interface ListingPageData {
  website: ListingWebsiteRow;
  property: PropertyRow;
  deliverables: DeliverableRow[];
  deliveryLinks: DeliveryLink[];
  heroImage: string;
  galleryImages: string[];
  selectedLinks: DeliveryLink[];
  tourEmbedUrl: string | null;
}

async function loadListing(slug: string): Promise<ListingPageData | null> {
  const service = getServiceSupabase();
  const { data: website, error: websiteError } = await service
    .from("listing_websites")
    .select(
      "property_id, booking_id, owner_id, template, slug, is_published, headline, description, feature_bullets, included_sections, gallery_image_urls, hero_image_url, agent_name, agent_email, agent_phone, brokerage_name, cta_text, cta_url",
    )
    .eq("slug", slug)
    .maybeSingle<ListingWebsiteRow>();

  if (websiteError || !website) return null;

  const [{ data: property }, { data: deliverables }] = await Promise.all([
    service
      .from("properties")
      .select("id, street_address, city, province, postal_code")
      .eq("id", website.property_id)
      .single<PropertyRow>(),
    service
      .from("deliverables")
      .select("id, type, source, url, thumbnail_url, metadata, ready_at, created_at")
      .eq("property_id", website.property_id)
      .not("ready_at", "is", null)
      .order("created_at", { ascending: false })
      .returns<DeliverableRow[]>(),
  ]);

  if (!property) return null;

  const ready = (deliverables ?? []).filter(
    (deliverable) =>
      deliverable.source !== "fotello" &&
      deliverable.url &&
      deliverable.url !== "about:blank",
  );
  const allGalleryImages = uniqueImageUrls(
    ready
    .flatMap((deliverable) => [
      ...metadataImageUrls(deliverable.metadata),
      deliverable.thumbnail_url,
      imageUrlOrNull(deliverable.url),
    ])
    .filter((url): url is string => Boolean(url)),
  );
  const deliveryLinks = buildDeliveryLinks(
    ready.map((deliverable) => ({
      id: deliverable.id,
      type: deliverable.type,
      source: deliverable.source,
      url: deliverable.url,
      metadata: deliverable.metadata,
    })),
    process.env.NEXT_PUBLIC_APP_URL ?? "",
  );
  const selectedLinks = filterIncludedLinks(deliveryLinks, website.included_sections);
  const tourEmbedUrl = findTourEmbedUrl(ready, website.included_sections);
  const heroImage =
    website.hero_image_url ??
    allGalleryImages[0] ??
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1800&q=80";

  return {
    website,
    property,
    deliverables: ready,
    deliveryLinks,
    selectedLinks,
    tourEmbedUrl,
    heroImage,
    galleryImages: includesSection(website.included_sections, "photos")
      ? selectedGalleryImages(website.gallery_image_urls, allGalleryImages)
      : [],
  };
}

const TEMPLATE_COMPONENTS: Record<
  ListingWebsiteTemplate,
  (props: { listing: ListingPageData }) => JSX.Element
> = {
  estate_cinematic: EstateCinematic,
  clean_mls_plus: CleanMLSPlus,
  modern_forest: ModernForest,
  editorial_magazine: EditorialMagazine,
};

function EstateCinematic({ listing }: { listing: ListingPageData }) {
  return (
    <ListingShell className="bg-[#0d1110] text-white">
      <Hero
        listing={listing}
        className="min-h-[78vh]"
        overlayClassName="bg-gradient-to-t from-[#0d1110] via-[#0d1110]/58 to-transparent"
        eyebrow="Private listing presentation"
        titleClassName="max-w-4xl text-5xl font-semibold tracking-tight md:text-7xl"
        buttonClassName="bg-[#d5b56f] text-[#17130c] hover:bg-[#ead28f]"
      />
      <main className="mx-auto max-w-6xl space-y-16 px-6 py-16">
        <SelectedMediaSections listing={listing} dark />
        <Gallery images={listing.galleryImages} dark cinematic />
        <Story listing={listing} dark />
        <AgentCard listing={listing} dark />
      </main>
    </ListingShell>
  );
}

function CleanMLSPlus({ listing }: { listing: ListingPageData }) {
  return (
    <ListingShell className="bg-white text-slate-950">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <img
              src={listing.heroImage}
              alt=""
              className="aspect-[16/10] w-full rounded-3xl object-cover"
            />
            <div className="mt-6">
              <AddressBlock listing={listing} />
            </div>
            <SelectedMediaSections listing={listing} />
          </div>
          <AgentCard listing={listing} sticky />
        </div>
        <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-12">
            <Story listing={listing} />
            <Gallery images={listing.galleryImages} />
          </div>
          <FeatureList listing={listing} />
        </div>
      </main>
    </ListingShell>
  );
}

function ModernForest({ listing }: { listing: ListingPageData }) {
  return (
    <ListingShell className="bg-[#f7f2e8] text-[#22352b]">
      <main className="mx-auto max-w-6xl space-y-14 px-6 py-12">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#315f45]">
            Featured property
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold md:text-6xl">
            {listing.website.headline ?? listing.property.street_address}
          </h1>
          <p className="mt-3 text-[#6f7a70]">{addressLine(listing.property)}</p>
        </div>
        <img
          src={listing.heroImage}
          alt=""
          className="aspect-[16/9] w-full rounded-[2rem] object-cover shadow-2xl shadow-[#315f45]/10"
        />
        <SelectedMediaSections listing={listing} />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-10">
            <Story listing={listing} />
            <Gallery images={listing.galleryImages} />
          </div>
          <div className="space-y-6">
            <FeatureList listing={listing} />
            <AgentCard listing={listing} />
          </div>
        </div>
      </main>
    </ListingShell>
  );
}

function EditorialMagazine({ listing }: { listing: ListingPageData }) {
  return (
    <ListingShell className="bg-[#f8f7f3] text-[#20201d]">
      <main className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#8b7a5f]">
              Property story
            </p>
            <h1 className="mt-5 text-5xl font-semibold leading-none md:text-7xl">
              {listing.website.headline ?? listing.property.street_address}
            </h1>
            <p className="mt-5 text-lg text-[#716d63]">
              {addressLine(listing.property)}
            </p>
          </div>
          <img
            src={listing.heroImage}
            alt=""
            className="aspect-[4/3] w-full rounded-t-[5rem] object-cover"
          />
        </div>
        <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-12">
            <Story listing={listing} editorial />
            <Gallery images={listing.galleryImages} editorial />
          </div>
          <div className="space-y-6">
            <SelectedMediaSections listing={listing} compact />
            <FeatureList listing={listing} />
            <AgentCard listing={listing} />
          </div>
        </div>
      </main>
    </ListingShell>
  );
}

function ListingShell({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative left-1/2 -mx-[50vw] -my-12 w-screen ${className}`}>
      {children}
    </div>
  );
}

function Hero({
  listing,
  className,
  overlayClassName,
  eyebrow,
  titleClassName,
  buttonClassName,
}: {
  listing: ListingPageData;
  className: string;
  overlayClassName: string;
  eyebrow: string;
  titleClassName: string;
  buttonClassName: string;
}) {
  return (
    <section className={`relative flex items-end overflow-hidden ${className}`}>
      <img
        src={listing.heroImage}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className={`absolute inset-0 ${overlayClassName}`} />
      <div className="relative mx-auto w-full max-w-6xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
          {eyebrow}
        </p>
        <h1 className={`mt-5 ${titleClassName}`}>
          {listing.website.headline ?? listing.property.street_address}
        </h1>
        <p className="mt-4 text-lg text-white/75">
          {addressLine(listing.property)}
        </p>
        <Cta listing={listing} className={`mt-8 inline-flex ${buttonClassName}`} />
      </div>
    </section>
  );
}

function AddressBlock({ listing }: { listing: ListingPageData }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#315f45]">
        Listing launch page
      </p>
      <h1 className="mt-2 text-4xl font-semibold md:text-5xl">
        {listing.website.headline ?? listing.property.street_address}
      </h1>
      <p className="mt-2 text-slate-500">{addressLine(listing.property)}</p>
    </div>
  );
}

function Story({
  listing,
  dark = false,
  editorial = false,
}: {
  listing: ListingPageData;
  dark?: boolean;
  editorial?: boolean;
}) {
  return (
    <section>
      <p
        className={`text-xs font-semibold uppercase tracking-[0.22em] ${
          dark ? "text-white/50" : "text-[#315f45]"
        }`}
      >
        Overview
      </p>
      <p
        className={`mt-4 max-w-3xl ${
          editorial ? "text-2xl leading-relaxed" : "text-lg leading-8"
        } ${dark ? "text-white/72" : "text-current/75"}`}
      >
        {listing.website.description ||
          "A polished custom listing page is ready for this property. Add the property description in the portal to replace this placeholder."}
      </p>
    </section>
  );
}

function FeatureList({ listing }: { listing: ListingPageData }) {
  const features = listing.website.feature_bullets.length
    ? listing.website.feature_bullets
    : ["Professional media package", "Virtual tour links", "Floor plan access"];
  return (
    <section className="rounded-3xl border border-current/10 bg-white/45 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] opacity-60">
        Features
      </p>
      <ul className="mt-4 grid gap-3">
        {features.map((feature) => (
          <li key={feature} className="rounded-2xl bg-current/5 px-4 py-3 text-sm">
            {feature}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Gallery({
  images,
  dark = false,
  cinematic = false,
  editorial = false,
}: {
  images: string[];
  dark?: boolean;
  cinematic?: boolean;
  editorial?: boolean;
}) {
  if (images.length === 0) return null;
  return (
    <section>
      <p
        className={`text-xs font-semibold uppercase tracking-[0.22em] ${
          dark ? "text-white/50" : "text-[#315f45]"
        }`}
      >
        Gallery
      </p>
      <div
        className={`mt-4 grid gap-3 ${
          cinematic || editorial
            ? "md:grid-cols-3"
            : "sm:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        {images.map((image, index) => (
          <img
            key={`${image}:${index}`}
            src={image}
            alt=""
            className={`w-full object-cover ${
              index === 0 && (cinematic || editorial)
                ? "aspect-[16/10] md:col-span-2"
                : "aspect-[4/3]"
            } ${editorial ? "rounded-[2rem]" : "rounded-3xl"}`}
            loading="lazy"
          />
        ))}
      </div>
    </section>
  );
}

function SelectedMediaSections({
  listing,
  dark = false,
  compact = false,
}: {
  listing: ListingPageData;
  dark?: boolean;
  compact?: boolean;
}) {
  const grouped = groupLinksBySection(listing.selectedLinks);
  const publicVideoLinks = grouped.video.filter((link) =>
    isStreamingVideoUrl(link.url),
  );
  const videoEmbeds = publicVideoLinks
    .map((link) => ({ link, embedUrl: videoEmbedUrl(link.url) }))
    .filter(
      (item): item is { link: DeliveryLink; embedUrl: string } =>
        Boolean(item.embedUrl),
    );
  const hasAny =
    Boolean(listing.tourEmbedUrl) ||
    grouped.tour.length > 0 ||
    grouped.floor_plans.length > 0 ||
    videoEmbeds.length > 0 ||
    grouped.property_websites.length > 0;
  if (!hasAny) return null;

  const panelClass = dark
    ? "border-white/12 bg-white/8 text-white"
    : "border-current/10 bg-white/65 text-current";
  const buttonClass = dark
    ? "border-white/15 bg-white/8 text-white hover:bg-white/14"
    : "border-current/10 bg-white/70 hover:bg-white";

  return (
    <section className="space-y-5">
      <p
        className={`text-xs font-semibold uppercase tracking-[0.22em] ${
          dark ? "text-white/50" : "text-[#315f45]"
        }`}
      >
        Included media
      </p>

      {listing.tourEmbedUrl ? (
        <div className={`overflow-hidden rounded-3xl border ${panelClass}`}>
          <div className="aspect-video w-full bg-black">
            <iframe
              src={listing.tourEmbedUrl}
              title="Virtual tour"
              className="h-full w-full"
              allowFullScreen
              loading="lazy"
            />
          </div>
        </div>
      ) : null}

      {videoEmbeds.map(({ link, embedUrl }) => (
        <div
          key={`${link.label}:${link.url}`}
          className={`overflow-hidden rounded-3xl border ${panelClass}`}
        >
          <div className="aspect-video w-full bg-black">
            <iframe
              src={embedUrl ?? link.url}
              title={link.label}
              className="h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          </div>
        </div>
      ))}

      {(["tour", "floor_plans", "video", "property_websites"] as const).map(
        (section) => {
          const sectionLinks = section === "video" ? publicVideoLinks : grouped[section];
          const links = sectionLinks.filter(
            (link) => !videoEmbeds.some((item) => item.link.url === link.url),
          );
          if (links.length === 0) return null;
          return (
            <div
              key={section}
              className={`rounded-3xl border p-4 ${panelClass}`}
            >
              <h2 className="text-lg font-semibold">{sectionTitle(section)}</h2>
              <div
                className={`mt-3 grid gap-2 ${
                  compact ? "" : "sm:grid-cols-2"
                }`}
              >
                {links.map((link) => (
                  <a
                    key={`${link.label}:${link.url}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener"
                    className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${buttonClass}`}
                  >
                    {link.label} ↗
                  </a>
                ))}
              </div>
            </div>
          );
        },
      )}
    </section>
  );
}

function MediaButtons({
  links,
  dark = false,
  compact = false,
}: {
  links: DeliveryLink[];
  dark?: boolean;
  compact?: boolean;
}) {
  if (links.length === 0) return null;
  const visible = compact ? links.slice(0, 6) : links.slice(0, 8);
  return (
    <section>
      <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {visible.map((link) => (
          <a
            key={`${link.label}:${link.url}`}
            href={link.url}
            target="_blank"
            rel="noopener"
            className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
              dark
                ? "border-white/15 bg-white/8 text-white hover:bg-white/14"
                : "border-current/10 bg-white/65 text-current hover:bg-white"
            }`}
          >
            {link.label} ↗
          </a>
        ))}
      </div>
    </section>
  );
}

function AgentCard({
  listing,
  dark = false,
  sticky = false,
}: {
  listing: ListingPageData;
  dark?: boolean;
  sticky?: boolean;
}) {
  return (
    <aside
      className={`rounded-3xl border p-5 ${
        sticky ? "lg:sticky lg:top-8 lg:self-start" : ""
      } ${
        dark
          ? "border-white/12 bg-white/8 text-white"
          : "border-current/10 bg-white/60"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.22em] opacity-60">
        Presented by
      </p>
      <h2 className="mt-3 text-2xl font-semibold">
        {listing.website.agent_name ?? "Your agent"}
      </h2>
      {listing.website.brokerage_name ? (
        <p className="mt-1 text-sm opacity-65">{listing.website.brokerage_name}</p>
      ) : null}
      <div className="mt-5 space-y-2 text-sm opacity-75">
        {listing.website.agent_email ? <p>{listing.website.agent_email}</p> : null}
        {listing.website.agent_phone ? <p>{listing.website.agent_phone}</p> : null}
      </div>
      <Cta
        listing={listing}
        className={`mt-6 flex w-full justify-center ${
          dark
            ? "bg-white text-[#0d1110] hover:bg-white/88"
            : "bg-[#315f45] text-white hover:bg-[#244735]"
        }`}
      />
    </aside>
  );
}

function Cta({
  listing,
  className,
}: {
  listing: ListingPageData;
  className: string;
}) {
  const href =
    listing.website.cta_url ??
    (listing.website.agent_email ? `mailto:${listing.website.agent_email}` : "#");
  return (
    <a
      href={href}
      className={`rounded-full px-5 py-3 text-sm font-semibold transition ${className}`}
    >
      {listing.website.cta_text ?? "Contact agent"}
    </a>
  );
}

function addressLine(property: PropertyRow): string {
  return [
    property.street_address,
    property.city,
    property.province,
    property.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
}

function selectedGalleryImages(
  savedSelection: string[] | null,
  availableImages: string[],
): string[] {
  const available = uniqueImageUrls(availableImages);
  if (savedSelection === null) return available.slice(0, 24);
  const availableSet = new Set(available);
  return savedSelection.filter((url) => availableSet.has(url)).slice(0, 24);
}

function includesSection(
  includedSections: string[] | null | undefined,
  section: string,
): boolean {
  return includedSections?.includes(section) ?? true;
}

function sectionForLink(link: DeliveryLink): string {
  return link.category;
}

function filterIncludedLinks(
  links: DeliveryLink[],
  includedSections: string[],
): DeliveryLink[] {
  return links.filter((link) =>
    includesSection(includedSections, sectionForLink(link)),
  );
}

function groupLinksBySection(links: DeliveryLink[]): Record<string, DeliveryLink[]> {
  return {
    photos: links.filter((link) => sectionForLink(link) === "photos"),
    tour: links.filter((link) => sectionForLink(link) === "tour"),
    floor_plans: links.filter((link) => sectionForLink(link) === "floor_plans"),
    video: links.filter((link) => sectionForLink(link) === "video"),
    property_websites: links.filter(
      (link) => sectionForLink(link) === "property_websites",
    ),
  };
}

function findTourEmbedUrl(
  deliverables: DeliverableRow[],
  includedSections: string[],
): string | null {
  if (!includesSection(includedSections, "tour")) return null;
  const tour = deliverables.find(
    (deliverable) =>
      deliverable.type === "virtual_tour" && deliverable.source === "iguide",
  );
  if (!tour) return null;
  const alias = metadataString(tour.metadata, "alias") ?? parseIGuideAlias(tour.url);
  return alias ? iguideEmbedUrl(alias) : null;
}

function videoEmbedUrl(url: string): string | null {
  if (!isStreamingVideoUrl(url)) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host.endsWith("youtube.com")) {
      const id = parsed.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
      if (parsed.pathname.startsWith("/embed/")) return url;
    }
    if (host.endsWith("vimeo.com")) {
      const id = parsed.pathname.split("/").filter(Boolean).find(Boolean);
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

function sectionTitle(section: string): string {
  if (section === "tour") return "Virtual tour links";
  if (section === "floor_plans") return "Floor plans and PDFs";
  if (section === "video") return "Video";
  if (section === "property_websites") return "Property websites";
  return "Media";
}
