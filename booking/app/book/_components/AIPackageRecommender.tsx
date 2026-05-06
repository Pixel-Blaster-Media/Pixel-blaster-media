"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { CatalogItemDTO } from "@/app/_components/CartPicker";

interface Props {
  bundles: CatalogItemDTO[];
  aLaCarte: CatalogItemDTO[];
  addons: CatalogItemDTO[];
}

interface Recommendation {
  services: string[];
  addOns: string[];
  title: string;
  confidence: "strong" | "good" | "light";
  reasoning: string;
  notes: string[];
}

export default function AIPackageRecommender({ bundles, aLaCarte, addons }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [description, setDescription] = useState("");
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);

  const bySlug = useMemo(() => {
    const m = new Map<string, CatalogItemDTO>();
    for (const item of [...bundles, ...aLaCarte, ...addons]) m.set(item.slug, item);
    return m;
  }, [bundles, aLaCarte, addons]);

  function recommend() {
    const next = buildRecommendation(description, bySlug);
    setRecommendation(next);
  }

  function applyRecommendation(next = recommendation) {
    if (!next) return;
    const out = new URLSearchParams(params.toString());
    out.set("services", next.services.join(","));
    if (next.addOns.length) out.set("add_ons", next.addOns.join(","));
    else out.delete("add_ons");
    // If they already had a later-step choice, service changes can change duration.
    out.delete("slot");
    router.replace(`?${out.toString()}`, { scroll: false });
  }

  return (
    <section className="rounded-xl border border-brand/30 bg-brand/10 p-4 shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-light">
            AI package guide
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">
            Not sure what to book?
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Describe the listing in plain English and we&apos;ll recommend the best
            package before you start clicking around.
          </p>
        </div>
        <span className="rounded-full border border-brand-light/30 bg-brand/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-light">
          Beta
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={4}
          placeholder="Example: 2,200 sqft detached home in Hamilton, occupied, basement included, realtor wants photos, iGUIDE, drone, and maybe a reel for Instagram."
          className="w-full rounded-lg border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={recommend}
            disabled={description.trim().length < 8}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            Recommend my package
          </button>
          <p className="text-xs text-ink-muted">
            You can still edit the selection manually after applying it.
          </p>
        </div>
      </div>

      {recommendation ? (
        <div className="mt-4 rounded-lg border border-white/10 bg-ink/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-ink-muted">
                Recommended
              </p>
              <h4 className="mt-1 text-base font-semibold text-white">
                {recommendation.title}
              </h4>
              <p className="mt-1 text-sm text-ink-muted">
                {recommendation.reasoning}
              </p>
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
              {recommendation.confidence} fit
            </span>
          </div>

          {recommendation.notes.length > 0 ? (
            <ul className="mt-3 grid gap-1 text-xs text-ink-muted md:grid-cols-2">
              {recommendation.notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span className="text-brand-light">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => applyRecommendation()}
              className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-brand-light hover:text-white"
            >
              Apply this package
            </button>
            <p className="text-xs text-ink-muted">
              This will select the package below and keep you on this page.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function buildRecommendation(
  raw: string,
  bySlug: Map<string, CatalogItemDTO>,
): Recommendation {
  const text = raw.toLowerCase();
  const sqft = extractSquareFootage(text);
  const mentionsVideo = hasAny(text, ["video", "reel", "instagram", "social", "walkthrough", "walk through", "tiktok"]);
  const mentionsDrone = hasAny(text, ["drone", "aerial", "acreage", "waterfront", "farm", "large lot", "pool", "view", "estate"]);
  const luxury = hasAny(text, ["luxury", "estate", "custom", "waterfront", "million", "$1", "$2", "high end", "high-end"]);
  const condo = hasAny(text, ["condo", "apartment", "unit"]);
  const detached = hasAny(text, ["detached", "house", "home", "townhouse", "bungalow", "semi"]);
  const vacant = hasAny(text, ["vacant", "empty", "unstaged"]);
  const occupied = hasAny(text, ["occupied", "tenant", "tenanted", "lived in", "seller lives"]);

  const addOns: string[] = [];
  if (hasAny(text, ["on camera", "agent on camera", "intro", "outro", "walk-and-talk", "walk and talk"]) && bySlug.has("on_camera")) {
    addOns.push("on_camera");
  }

  let slug = "blue_print";
  let confidence: Recommendation["confidence"] = "good";
  const notes: string[] = [];

  if (luxury || (mentionsVideo && mentionsDrone && sqft && sqft >= 3000)) {
    slug = bySlug.has("ultimate") ? "ultimate" : "social_media_plus";
    confidence = "strong";
    notes.push("Luxury or large listings benefit from both full video and social-ready assets.");
  } else if (mentionsVideo && (mentionsDrone || sqft == null || sqft >= 1800 || detached)) {
    slug = bySlug.has("social_media_plus") ? "social_media_plus" : "social_media_special";
    confidence = "strong";
    notes.push("Video plus drone gives the listing more reach on social and stronger perceived value.");
  } else if (mentionsVideo) {
    slug = bySlug.has("social_media_special") ? "social_media_special" : "video_tour";
    confidence = "good";
    notes.push("A reel-style package should cover the social marketing need without overbuilding it.");
  } else if (condo && sqft && sqft <= 1200) {
    slug = bySlug.has("blue_print") ? "blue_print" : "residential_photography";
    confidence = "good";
    notes.push("For a smaller condo, photos plus floor plan/tour usually covers MLS needs cleanly.");
  } else if (mentionsDrone && bySlug.has("aerial_photography")) {
    slug = bySlug.has("blue_print") ? "blue_print" : "residential_photography";
    notes.push("Drone was mentioned, so consider adding aerial photography if it is not included in the selected package.");
  }

  if (sqft && sqft > 2500) {
    notes.push("Over 2,500 sqft may need extra measuring/video time depending on final package.");
  }
  if (occupied) {
    notes.push("Occupied listing: send prep notes for decluttering, pets, access, and seller readiness.");
  } else if (vacant) {
    notes.push("Vacant listing: faster access, but make sure utilities/lights are on before arrival.");
  }
  if (mentionsDrone && !["social_media_special", "social_media_plus", "ultimate"].includes(slug)) {
    notes.push("Drone/aerial could be a smart add-on for exterior appeal or larger lots.");
  }

  const item = bySlug.get(slug) ?? firstAvailable(bySlug, ["blue_print", "residential_photography"]);
  const services = item ? [item.slug] : [];
  const serviceName = item?.name ?? "a custom package";

  return {
    services,
    addOns,
    title: serviceName,
    confidence,
    reasoning: describeFit(serviceName, { condo, detached, luxury, mentionsVideo, mentionsDrone, sqft }),
    notes,
  };
}

function describeFit(
  serviceName: string,
  ctx: {
    condo: boolean;
    detached: boolean;
    luxury: boolean;
    mentionsVideo: boolean;
    mentionsDrone: boolean;
    sqft: number | null;
  },
): string {
  const details: string[] = [];
  if (ctx.sqft) details.push(`around ${ctx.sqft.toLocaleString()} sqft`);
  if (ctx.condo) details.push("condo-style listing");
  else if (ctx.detached) details.push("house-style listing");
  if (ctx.luxury) details.push("higher-end marketing need");
  if (ctx.mentionsVideo) details.push("video/social content requested");
  if (ctx.mentionsDrone) details.push("exterior/drone opportunity");

  return details.length
    ? `${serviceName} is the best fit based on: ${details.join(", ")}.`
    : `${serviceName} is a safe starting point based on the description. You can fine-tune it below.`;
}

function extractSquareFootage(text: string): number | null {
  const match = text.match(/(\d[\d,\.]{2,})\s*(sq\s*ft|sqft|square feet|sf)/i);
  if (!match) return null;
  const n = Number(match[1].replace(/[,\.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function firstAvailable(
  bySlug: Map<string, CatalogItemDTO>,
  slugs: string[],
): CatalogItemDTO | null {
  for (const slug of slugs) {
    const item = bySlug.get(slug);
    if (item) return item;
  }
  return null;
}
