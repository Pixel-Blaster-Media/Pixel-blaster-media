"use client";

import { useRouter, useSearchParams } from "next/navigation";

import type { WizardState } from "@/lib/booking/wizard-state";

interface CatalogLite {
  slug: string;
  name: string;
  price_cents: number;
  duration_minutes: number;
  require_has_video: boolean;
}

export default function ConfirmUpsellPanel({
  state,
  catalog,
}: {
  state: WizardState;
  catalog: CatalogLite[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const bySlug = new Map(catalog.map((item) => [item.slug, item]));

  const hasPhoto = hasAny(state.services, [
    "residential_photography",
    "blue_print",
    "social_media_special",
    "social_media_plus",
    "ultimate",
  ]);
  const hasIGuide = hasAny(state.services, [
    "iguide_measurements",
    "blue_print",
    "social_media_special",
    "social_media_plus",
    "ultimate",
  ]);
  const hasDrone = hasAny(state.services, [
    "aerial_photography",
    "social_media_special",
    "social_media_plus",
    "ultimate",
  ]);
  const hasVideo = hasAny(state.services, [
    "social_media_reel",
    "video_tour",
    "social_media_special",
    "social_media_plus",
    "ultimate",
  ]);

  const propertySignals = getPropertySignals(state);
  const upgrades: Array<{
    slug: string;
    eyebrow: string;
    title: string;
    reason: string;
    priority: number;
  }> = [];

  if (!hasPhoto && bySlug.has("residential_photography")) {
    upgrades.push({
      slug: "residential_photography",
      eyebrow: "Core listing asset",
      title: "Add residential photos",
      reason:
        "Photos are still the main MLS asset and pair well with tours, drone, or video.",
      priority: 90,
    });
  }

  if (hasPhoto && !hasIGuide && bySlug.has("iguide_measurements")) {
    upgrades.push({
      slug: "iguide_measurements",
      eyebrow: "MLS confidence",
      title: "Add iGUIDE + measurements",
      reason:
        state.squareFootage && state.squareFootage >= 1800
          ? `At about ${state.squareFootage.toLocaleString()} sqft, floor plans and measurements help buyers understand the layout.`
          : "Adds floor plans, room measurements, a virtual tour, and listing analytics.",
      priority: state.squareFootage && state.squareFootage >= 1800 ? 85 : 60,
    });
  }

  if ((hasPhoto || hasIGuide) && !hasDrone && bySlug.has("aerial_photography")) {
    if (!propertySignals.isCondoLike) {
      upgrades.push({
        slug: "aerial_photography",
        eyebrow: propertySignals.droneStrong ? "Strong fit" : "Exterior context",
        title: "Add drone photos",
        reason: propertySignals.droneReason,
        priority: propertySignals.droneStrong ? 100 : 70,
      });
    }
  }

  if (!hasVideo && bySlug.has("social_media_reel")) {
    upgrades.push({
      slug: "social_media_reel",
      eyebrow: propertySignals.isCondoLike ? "Better condo upgrade" : "Social boost",
      title: "Add a social media reel",
      reason: propertySignals.isCondoLike
        ? "For a condo, social content is usually a smarter upgrade than drone because it helps the listing stand out online."
        : "Gives the realtor quick vertical content for Instagram, Facebook, and TikTok.",
      priority: propertySignals.isCondoLike ? 95 : 65,
    });
  }

  const visible = upgrades
    .filter((u) => !state.services.includes(u.slug))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);

  if (visible.length === 0) return null;

  function addService(slug: string) {
    const next = new URLSearchParams(params.toString());
    const services = [...state.services, slug].filter(unique);
    next.set("services", services.join(","));
    router.replace(`/book/confirm?${next.toString()}`, { scroll: false });
  }

  return (
    <section className="rounded-xl border border-brand-light/25 bg-brand/10 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-light">
            Recommended for this property
          </p>
          <h3 className="mt-1 text-base font-semibold text-white">
            Smart final check before booking
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Based on the address/details and what you selected, these may help market this listing better.
          </p>
        </div>
        {propertySignals.shortLabel ? (
          <span className="rounded-full border border-white/10 bg-ink/40 px-3 py-1 text-[11px] text-ink-muted">
            {propertySignals.shortLabel}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {visible.map((upgrade) => {
          const item = bySlug.get(upgrade.slug);
          if (!item) return null;
          return (
            <button
              key={upgrade.slug}
              type="button"
              onClick={() => addService(upgrade.slug)}
              className="rounded-lg border border-white/10 bg-ink/50 p-3 text-left transition hover:border-brand-light/60 hover:bg-brand/15"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-light/90">
                {upgrade.eyebrow}
              </span>
              <span className="mt-1 flex items-start justify-between gap-3">
                <span className="font-semibold text-white">{upgrade.title}</span>
                <span className="shrink-0 font-semibold text-brand-light">
                  +${(item.price_cents / 100).toFixed(0)}
                </span>
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-ink-muted">
                {upgrade.reason}
              </span>
              <span className="mt-3 inline-flex rounded-full border border-brand-light/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-light">
                Add to booking
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function hasAny(selected: string[], slugs: string[]) {
  return selected.some((slug) => slugs.includes(slug));
}

function unique(value: string, index: number, array: string[]) {
  return array.indexOf(value) === index;
}

function getPropertySignals(state: WizardState) {
  const text = [
    state.streetAddress,
    state.unitNumber,
    state.city,
    state.postalCode,
  ]
    .join(" ")
    .toLowerCase();

  const ruralWords = [
    "rural",
    "acre",
    "farm",
    "county road",
    "concession",
    "sideroad",
    "side road",
    "line ",
    "rr ",
  ];
  const featureWords = ["lake", "waterfront", "ravine", "pool", "estate"];
  const condoWords = ["unit", "suite", "apt", "apartment", "condo"];

  const isCondoLike =
    Boolean(state.unitNumber) || condoWords.some((word) => text.includes(word));
  const looksRural = ruralWords.some((word) => text.includes(word));
  const hasExteriorFeature = featureWords.some((word) => text.includes(word));
  const isLarge = Boolean(state.squareFootage && state.squareFootage >= 2500);
  const droneStrong = looksRural || hasExteriorFeature || isLarge;

  return {
    isCondoLike,
    droneStrong,
    shortLabel: isCondoLike
      ? "Condo / unit-style property"
      : looksRural
        ? "Rural / country-style clues"
        : isLarge
          ? `${state.squareFootage?.toLocaleString()} sqft property`
          : null,
    droneReason: looksRural
      ? "This address has rural/country-style clues, so aerials can show the lot, driveway, privacy, and surrounding area."
      : hasExteriorFeature
        ? "The address/details suggest exterior features worth showing from above."
        : isLarge
          ? "For a larger property, aerials help show scale, yard, parking, and exterior context."
          : "Useful when the listing has a lot, corner position, exterior features, or premium curb appeal.",
  };
}
