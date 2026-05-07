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
  name: string;
  helper: string;
  previewClass: string;
}> = [
  {
    id: "clean_mls_plus",
    name: "Clean MLS Plus",
    helper: "Bright and practical.",
    previewClass: "bg-white text-slate-950 ring-slate-200",
  },
  {
    id: "modern_forest",
    name: "Modern Forest",
    helper: "Warm and earthy.",
    previewClass: "bg-[#f7f2e8] text-[#21382b] ring-[#2f6b4f]/30",
  },
  {
    id: "estate_cinematic",
    name: "Estate Cinematic",
    helper: "Dark and premium.",
    previewClass: "bg-[#111513] text-white ring-[#c8a96a]/40",
  },
  {
    id: "editorial_magazine",
    name: "Editorial Magazine",
    helper: "Stylish and story-led.",
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
  const selectedGalleryImages =
    initial?.gallery_image_urls ?? defaults.heroImageOptions;
  const includedSections = new Set(
    initial?.included_sections ?? SECTION_OPTIONS.map((option) => option.id),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const publicUrl = `${defaults.publicBaseUrl}/listings/${slug || defaults.slug}`;

  return (
    <section className="realtor-elevated-panel rounded-3xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
            Listing website
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-realtor-text">
            Create a public listing page
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-realtor-muted">
            Pick a design, write the listing copy, and publish a shareable page
            for buyers, sellers, and social posts.
          </p>
        </div>
        {initial?.slug ? (
          <a
            href={`/listings/${initial.slug}`}
            target="_blank"
            rel="noopener"
            className="rounded-full border border-realtor-primary/20 px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:text-realtor-text"
          >
            Preview page ↗
          </a>
        ) : null}
      </div>

      <form
        className="mt-5 space-y-5"
        action={(formData) => {
          setMessage(null);
          setError(null);
          startTransition(async () => {
            const result = await savePortalListingWebsite(propertyId, formData);
            if (!result.ok) {
              setError(result.error ?? "Could not save listing website.");
              return;
            }
            if (result.slug) setSlug(result.slug);
            setMessage(
              isPublished
                ? "Listing website saved and published."
                : "Listing website saved as private.",
            );
          });
        }}
      >
        <input type="hidden" name="existing_slug" value={initial?.slug ?? ""} />

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {TEMPLATES.map((option) => {
            const selected = option.id === template;
            return (
              <label
                key={option.id}
                className={`cursor-pointer rounded-2xl border p-3 transition ${
                  selected
                    ? "border-realtor-primary bg-realtor-primary/10"
                    : "border-realtor-primary/15 bg-realtor-surface-muted/70 hover:border-realtor-primary/35"
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
                  <div className="h-14 rounded-lg bg-current/15" />
                  <div className="mt-3 h-2 w-3/4 rounded-full bg-current/40" />
                  <div className="mt-2 h-2 w-1/2 rounded-full bg-current/25" />
                </div>
                <p className="mt-3 text-sm font-semibold text-realtor-text">
                  {option.name}
                </p>
                <p className="mt-1 text-xs text-realtor-muted">
                  {option.helper}
                </p>
              </label>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
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
                          ? "border-realtor-primary"
                          : "border-realtor-primary/15 hover:border-realtor-primary/35"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        className="aspect-[4/3] w-full object-cover"
                      />
                      <span className="block px-2 py-1 text-[11px] text-realtor-muted">
                        {heroImageUrl === url ? "Hero selected" : `Image ${index + 1}`}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </Field>

            {defaults.heroImageOptions.length > 0 ? (
              <div className="realtor-green-panel rounded-2xl p-4">
                <p className="text-sm font-semibold text-realtor-text">
                  Website gallery photos
                </p>
                <p className="mt-1 text-xs text-realtor-muted">
                  Uncheck any photos you do not want shown on the public page.
                  Click a photo above to make it the hero shot.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {defaults.heroImageOptions.slice(0, 24).map((url, index) => (
                    <label
                      key={url}
                      className="group overflow-hidden rounded-2xl border border-realtor-primary/15 bg-realtor-surface/70"
                    >
                      <input
                        type="checkbox"
                        name="gallery_image_urls"
                        value={url}
                        defaultChecked={selectedGalleryImages.includes(url)}
                        className="sr-only peer"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        className="aspect-[4/3] w-full object-cover opacity-45 transition peer-checked:opacity-100"
                      />
                      <span className="flex items-center justify-between px-2 py-1 text-[11px] text-realtor-muted peer-checked:text-realtor-text">
                        Photo {index + 1}
                        <span className="rounded-full border border-realtor-primary/20 px-2 py-0.5">
                          Show
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="realtor-green-panel rounded-2xl p-4">
              <p className="text-sm font-semibold text-realtor-text">
                Show on public page
              </p>
              <p className="mt-1 text-xs text-realtor-muted">
                Choose which delivered assets should appear directly on the
                custom website.
              </p>
              <div className="mt-3 space-y-2">
                {SECTION_OPTIONS.map((option) => (
                  <label
                    key={option.id}
                    className="flex items-start gap-2 rounded-xl border border-realtor-primary/15 bg-realtor-surface/70 px-3 py-2"
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
            </div>

            <div className="realtor-warm-panel rounded-2xl p-4">
              <p className="text-sm font-semibold text-realtor-text">Publish</p>
              <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-realtor-primary/15 bg-realtor-surface/70 px-3 py-2">
                <span className="text-sm text-realtor-text">Public website</span>
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
            </div>

            <div className="realtor-green-panel rounded-2xl p-4">
              <p className="text-sm font-semibold text-realtor-text">Contact</p>
              <div className="mt-3 space-y-3">
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
            </div>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-realtor-primary/20 transition hover:bg-realtor-primary-light disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save listing website"}
        </button>
      </form>
    </section>
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
