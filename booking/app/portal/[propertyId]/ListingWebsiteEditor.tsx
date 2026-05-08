"use client";

import { useState, useTransition } from "react";

import type { ListingWebsiteTemplate } from "@/lib/supabase/database.types";

import { savePortalListingWebsite } from "./listing-website-actions";

interface ListingWebsiteInitial {
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

interface Defaults {
  slug: string;
  headline: string;
  agentName: string;
  agentEmail: string;
  heroImageUrl: string;
  heroImageOptions: string[];
  publicBaseUrl: string;
}

const TEMPLATES: Array<{
  id: ListingWebsiteTemplate;
  eyebrow: string;
  name: string;
  helper: string;
  bestFor: string;
  previewClass: string;
}> = [
  {
    id: "clean_mls_plus",
    eyebrow: "Custom page 1",
    name: "Bright MLS-style",
    helper: "Clean, simple, and photo-forward.",
    bestFor: "Most listings, quick sharing, easy reading",
    previewClass: "bg-white text-slate-950 ring-slate-200",
  },
  {
    id: "modern_forest",
    eyebrow: "Custom page 2",
    name: "Modern Forest",
    helper: "Warm, earthy, and upscale.",
    bestFor: "Modern homes, lifestyle listings, soft branding",
    previewClass: "bg-[#f7f2e8] text-[#21382b] ring-[#2f6b4f]/30",
  },
  {
    id: "estate_cinematic",
    eyebrow: "Custom page 3",
    name: "Luxury / Cinematic",
    helper: "Dark, dramatic, and premium.",
    bestFor: "Luxury homes, hero photos, big visual impact",
    previewClass: "bg-[#111513] text-white ring-[#c8a96a]/40",
  },
  {
    id: "editorial_magazine",
    eyebrow: "Custom page 4",
    name: "Editorial Magazine",
    helper: "Elegant, curated, and story-led.",
    bestFor: "Character homes, design-heavy listings, agent branding",
    previewClass: "bg-[#f8f7f3] text-[#20201d] ring-[#9f8f77]/35",
  },
];

const SECTION_OPTIONS = [
  {
    id: "photos",
    label: "Photos",
    helper: "Show delivered photo galleries/images on the page.",
  },
  {
    id: "tour",
    label: "Virtual tour",
    helper: "Embed the iGUIDE tour directly on the page.",
  },
  {
    id: "floor_plans",
    label: "Floor plans",
    helper: "Show floor plan and overview PDF buttons.",
  },
  {
    id: "video",
    label: "Video",
    helper: "Show video links or embeds.",
  },
] as const;

export default function ListingWebsiteEditor({
  propertyId,
  initial,
  defaults,
}: {
  propertyId: string;
  initial: ListingWebsiteInitial | null;
  defaults: Defaults;
}) {
  const [template, setTemplate] = useState<ListingWebsiteTemplate>(
    initial?.template ?? "clean_mls_plus",
  );
  const [isPublished, setIsPublished] = useState(
    initial?.is_published ?? false,
  );
  const [slug, setSlug] = useState(initial?.slug ?? defaults.slug);
  const [heroImageUrl, setHeroImageUrl] = useState(
    initial?.hero_image_url ?? defaults.heroImageUrl,
  );
  const [galleryImageUrls, setGalleryImageUrls] = useState(
    initial?.gallery_image_urls ?? defaults.heroImageOptions,
  );
  const includedSections = new Set(
    initial?.included_sections ?? SECTION_OPTIONS.map((option) => option.id),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const publicUrl = `${defaults.publicBaseUrl}/listings/${slug || defaults.slug}`;

  return (
    <section className="space-y-4">
      <div className="realtor-elevated-panel rounded-3xl p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
              Custom listing page
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-realtor-text">
              Choose one of 4 custom pages
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-realtor-muted">
              Pick a design, add the listing copy, choose the media to show,
              then publish a polished property website agents can share.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                isPublished
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-realtor-primary/15 bg-realtor-surface-muted text-realtor-muted"
              }`}
            >
              {isPublished ? "Public" : "Private"}
            </span>
            {initial?.slug ? (
              <a
                href={`/listings/${initial.slug}`}
                target="_blank"
                rel="noopener"
                className="rounded-full border border-realtor-primary/20 bg-realtor-surface px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:text-realtor-text"
              >
                Preview custom page
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <form
        className="space-y-4"
        action={(formData) => {
          setMessage(null);
          setError(null);
          startTransition(async () => {
            const result = await savePortalListingWebsite(propertyId, formData);
            if (!result.ok) {
              setError(result.error ?? "Could not save custom listing page.");
              return;
            }
            if (result.slug) setSlug(result.slug);
            setMessage(
              isPublished
                ? "Custom listing page saved and published."
                : "Custom listing page saved as private.",
            );
          });
        }}
      >
        <input type="hidden" name="existing_slug" value={initial?.slug ?? ""} />

        <CreatorSection
          title="Choose a custom page"
          description="Agents can switch between these 4 designs any time before sharing."
          icon="template"
        >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {TEMPLATES.map((option) => {
            const selected = option.id === template;
            return (
              <label
                key={option.id}
                className={`cursor-pointer rounded-2xl border p-3 transition ${
                  selected
                    ? "border-realtor-primary bg-realtor-primary/10 shadow-sm shadow-realtor-primary/10"
                    : "border-realtor-primary/15 bg-realtor-surface-muted/70 hover:border-realtor-primary/35 hover:bg-realtor-surface"
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  value={option.id}
                  checked={selected}
                  onChange={() => setTemplate(option.id)}
                  className="sr-only"
                />
                <div className={`rounded-xl p-3 ring-1 ${option.previewClass}`}>
                  <div className="h-16 rounded-lg bg-current/15" />
                  <div className="mt-3 h-2 w-3/4 rounded-full bg-current/40" />
                  <div className="mt-2 h-2 w-1/2 rounded-full bg-current/25" />
                </div>
                <div className="mt-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-primary">
                      {option.eyebrow}
                    </p>
                    <p className="text-sm font-semibold text-realtor-text">
                      {option.name}
                    </p>
                    <p className="mt-1 text-xs text-realtor-muted">
                      {option.helper}
                    </p>
                  </div>
                  {selected ? (
                    <span className="rounded-full bg-realtor-primary px-2 py-0.5 text-[10px] font-semibold text-white">
                      Selected
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 rounded-xl bg-realtor-surface/75 px-3 py-2 text-[11px] leading-relaxed text-realtor-muted">
                  {option.bestFor}
                </p>
              </label>
            );
          })}
        </div>
        </CreatorSection>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <CreatorSection
              title="Listing copy"
              description="This is the main text buyers and sellers will read."
              icon="copy"
            >
            <Field label="Listing headline">
              <input
                name="headline"
                defaultValue={initial?.headline ?? defaults.headline}
                className="realtor-field w-full rounded-xl px-3 py-2.5"
              />
            </Field>
            <Field label="Property description">
              <textarea
                name="description"
                rows={6}
                defaultValue={initial?.description ?? ""}
                placeholder="Write the property description here."
                className="realtor-field w-full rounded-xl px-3 py-2.5"
              />
            </Field>
            <Field label="Feature bullets">
              <textarea
                name="feature_bullets"
                rows={4}
                defaultValue={(initial?.feature_bullets ?? []).join("\n")}
                placeholder={"Updated kitchen\nFinished basement\nGreat neighbourhood"}
                className="realtor-field w-full rounded-xl px-3 py-2.5"
              />
              <p className="mt-1 text-[11px] text-realtor-muted">
                One feature per line.
              </p>
            </Field>
            </CreatorSection>

            <CreatorSection
              title="Photos"
              description="Set the main image and choose the photos that appear on the custom listing page."
              icon="photos"
            >
            <Field label="Hero image">
              <input
                name="hero_image_url"
                type="url"
                value={heroImageUrl}
                onChange={(event) => setHeroImageUrl(event.target.value)}
                placeholder="https://..."
                className="realtor-field w-full rounded-xl px-3 py-2.5"
              />
              {defaults.heroImageOptions.length > 0 ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {defaults.heroImageOptions.slice(0, 12).map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setHeroImageUrl(url)}
                      className={`overflow-hidden rounded-2xl border text-left transition ${
                        heroImageUrl === url
                          ? "border-realtor-primary bg-realtor-primary/5 shadow-sm shadow-realtor-primary/10"
                          : "border-realtor-primary/15 bg-realtor-surface/80 hover:border-realtor-primary/35 hover:bg-realtor-surface"
                      }`}
                    >
                      <span className="relative block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt=""
                          className="aspect-[4/3] w-full object-cover"
                        />
                        {heroImageUrl === url ? (
                          <span className="absolute left-2 top-2 rounded-full bg-realtor-primary px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm">
                            Hero
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-realtor-muted">
                        <span>Image {index + 1}</span>
                        <span className="font-semibold text-realtor-primary">
                          {heroImageUrl === url ? "Selected" : "Use as hero"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </Field>

            {defaults.heroImageOptions.length > 0 ? (
              <div className="realtor-green-panel rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-realtor-text">
                      Website gallery photos
                    </p>
                    <p className="mt-1 text-xs text-realtor-muted">
                      iGUIDE supplied {defaults.heroImageOptions.length} web preview{" "}
                      {defaults.heroImageOptions.length === 1 ? "photo" : "photos"} for
                      this custom listing page. The full MLS and high-res photo sets stay as
                      download buttons in the media tab.
                    </p>
                  </div>
                  <span className="rounded-full border border-realtor-primary/20 bg-realtor-surface px-3 py-1 text-[11px] font-semibold text-realtor-primary">
                    {galleryImageUrls.length} shown
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {defaults.heroImageOptions.slice(0, 24).map((url, index) => (
                    <GalleryPhotoToggle
                      key={url}
                      url={url}
                      index={index}
                      shown={galleryImageUrls.includes(url)}
                      onToggle={(checked) => {
                        setGalleryImageUrls((current) => {
                          if (checked) return [...new Set([...current, url])];
                          return current.filter((item) => item !== url);
                        });
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-realtor-primary/20 bg-realtor-surface-muted/70 p-4 text-sm text-realtor-muted">
                No web preview photos are attached yet. Once iGUIDE sends preview
                images, they will appear here for the custom listing page.
              </div>
            )}
            </CreatorSection>
          </div>

          <div className="space-y-4">
            <CreatorSection
              title="Included media"
              description="Choose which delivered assets should appear directly on the custom listing page."
              icon="media"
            >
              <div className="space-y-2">
                {SECTION_OPTIONS.map((option) => (
                  <label
                    key={option.id}
                    className="flex items-start gap-2 rounded-xl border border-realtor-primary/15 bg-realtor-surface-muted/70 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      name="included_sections"
                      value={option.id}
                      defaultChecked={includedSections.has(option.id)}
                      className="mt-1 h-4 w-4 accent-realtor-primary"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-realtor-text">
                        {option.label}
                      </span>
                      <span className="block text-[11px] text-realtor-muted">
                        {option.helper}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </CreatorSection>

            <CreatorSection
              title="Publish custom page"
              description="Control whether the custom listing page is live."
              icon="publish"
            >
              <label className="flex items-center justify-between gap-3 rounded-xl border border-realtor-primary/15 bg-realtor-surface-muted/70 px-3 py-2">
                <span className="text-sm text-realtor-text">Public custom page</span>
                <input
                  type="checkbox"
                  name="is_published"
                  checked={isPublished}
                  onChange={(event) => setIsPublished(event.target.checked)}
                  className="h-4 w-4 accent-realtor-primary"
                />
              </label>
              <Field label="Public URL">
                <input
                  name="slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  className="realtor-field w-full rounded-xl px-3 py-2.5"
                />
              </Field>
              <p className="mt-2 break-all text-[11px] text-realtor-muted">
                {publicUrl}
              </p>
            </CreatorSection>

            <CreatorSection
              title="Agent contact"
              description="This contact block appears on the custom listing page."
              icon="contact"
            >
              <div className="space-y-3">
                <Field label="Agent name">
                  <input
                    name="agent_name"
                    defaultValue={initial?.agent_name ?? defaults.agentName}
                    className="realtor-field w-full rounded-xl px-3 py-2.5"
                  />
                </Field>
                <Field label="Agent email">
                  <input
                    name="agent_email"
                    type="email"
                    defaultValue={initial?.agent_email ?? defaults.agentEmail}
                    className="realtor-field w-full rounded-xl px-3 py-2.5"
                  />
                </Field>
                <Field label="Agent phone">
                  <input
                    name="agent_phone"
                    defaultValue={initial?.agent_phone ?? ""}
                    className="realtor-field w-full rounded-xl px-3 py-2.5"
                  />
                </Field>
                <Field label="Brokerage">
                  <input
                    name="brokerage_name"
                    defaultValue={initial?.brokerage_name ?? ""}
                    className="realtor-field w-full rounded-xl px-3 py-2.5"
                  />
                </Field>
                <Field label="Button text">
                  <input
                    name="cta_text"
                    defaultValue={initial?.cta_text ?? "Contact agent"}
                    className="realtor-field w-full rounded-xl px-3 py-2.5"
                  />
                </Field>
                <Field label="Button link">
                  <input
                    name="cta_url"
                    defaultValue={
                      initial?.cta_url ||
                      (defaults.agentEmail
                        ? `mailto:${defaults.agentEmail}`
                        : "")
                    }
                    className="realtor-field w-full rounded-xl px-3 py-2.5"
                  />
                </Field>
              </div>
            </CreatorSection>
          </div>
        </div>

        <div className="realtor-elevated-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <div>
            {error ? (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : message ? (
              <p className="text-sm text-emerald-700">{message}</p>
            ) : (
              <p className="text-sm text-realtor-muted">
                Save changes before sharing the custom listing page.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-realtor-primary/20 transition hover:bg-realtor-primary-light disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save custom listing page"}
          </button>
        </div>
      </form>
    </section>
  );
}

type CreatorIconKind =
  | "template"
  | "copy"
  | "photos"
  | "publish"
  | "media"
  | "contact";

function CreatorSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: CreatorIconKind;
  children: React.ReactNode;
}) {
  return (
    <section className="realtor-elevated-panel rounded-2xl p-4 md:p-5">
      <div className="space-y-4">
        <div className="flex min-w-0 items-start gap-3">
          <CreatorIcon kind={icon} />
          <div className="min-w-0 pt-0.5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-realtor-text">
              {title}
            </h3>
            <p className="mt-1 text-xs text-realtor-muted">{description}</p>
          </div>
        </div>
        <div className="grid gap-3">{children}</div>
      </div>
    </section>
  );
}

function GalleryPhotoToggle({
  url,
  index,
  shown,
  onToggle,
}: {
  url: string;
  index: number;
  shown: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <label
      className={`group cursor-pointer overflow-hidden rounded-2xl border bg-realtor-surface transition ${
        shown
          ? "border-realtor-primary shadow-sm shadow-realtor-primary/10"
          : "border-realtor-primary/15 opacity-70 hover:border-realtor-primary/35 hover:opacity-100"
      }`}
    >
      <input
        type="checkbox"
        name="gallery_image_urls"
        value={url}
        checked={shown}
        onChange={(event) => onToggle(event.target.checked)}
        className="sr-only"
      />
      <span className="relative block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          className={`aspect-[4/3] w-full object-cover transition ${
            shown ? "opacity-100" : "opacity-50 grayscale-[20%]"
          }`}
        />
        <span
          className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider shadow-sm ${
            shown
              ? "bg-realtor-primary text-white"
              : "bg-realtor-surface/90 text-realtor-muted"
          }`}
        >
          {shown ? "Shown" : "Hidden"}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]">
        <span className="font-medium text-realtor-text">Photo {index + 1}</span>
        <span className="font-semibold text-realtor-primary">
          {shown ? "Tap to hide" : "Tap to show"}
        </span>
      </span>
    </label>
  );
}

function CreatorIcon({ kind }: { kind: CreatorIconKind }) {
  const common = "h-5 w-5";
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-realtor-primary/10 text-realtor-primary ring-1 ring-realtor-primary/10">
      {kind === "template" ? (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 5h14v14H5zM8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : kind === "copy" ? (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 5h10M7 9h10M7 13h7M7 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : kind === "photos" ? (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="m7 16 4-4 3 3 2-2 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : kind === "publish" ? (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v10M8 9l4-4 4 4M6 19h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : kind === "media" ? (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 7h10M5 7h.01M9 12h10M5 12h.01M9 17h10M5 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg className={common} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 19c1.6-3.2 4-4.8 7-4.8s5.4 1.6 7 4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
