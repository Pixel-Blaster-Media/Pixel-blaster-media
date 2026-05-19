"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { CatalogItemDTO } from "@/app/_components/CartPicker";
import {
  recommendBookingPackage,
  type BookingRecommendation,
} from "@/app/book/recommendation-actions";

interface Props {
  bundles: CatalogItemDTO[];
  aLaCarte: CatalogItemDTO[];
  addons: CatalogItemDTO[];
  organizationSlug: string;
}

export default function AIPackageRecommender({
  bundles,
  aLaCarte,
  addons,
  organizationSlug,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [description, setDescription] = useState("");
  const [recommendation, setRecommendation] =
    useState<BookingRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const bySlug = useMemo(() => {
    const m = new Map<string, CatalogItemDTO>();
    for (const item of [...bundles, ...aLaCarte, ...addons]) m.set(item.slug, item);
    return m;
  }, [bundles, aLaCarte, addons]);

  function recommend() {
    setError(null);
    setRecommendation(null);
    startTransition(async () => {
      try {
        const result = await recommendBookingPackage({
          description,
          organizationSlug,
        });
        if (result.ok) {
          setRecommendation(result.recommendation);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not make a recommendation right now.",
        );
      }
    });
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

  const selectedNames = recommendation
    ? [...recommendation.services, ...recommendation.addOns]
        .map((slug) => bySlug.get(slug)?.name)
        .filter(Boolean)
    : [];

  return (
    <section className="realtor-green-panel rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary">
            AI package guide
          </p>
          <h3 className="mt-1 text-lg font-semibold text-realtor-text">
            Not sure what to book?
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-realtor-muted">
            Describe the listing in plain English and we&apos;ll recommend the best
            package before you start clicking around.
          </p>
        </div>
        <span className="rounded-full border border-realtor-primary/30 bg-realtor-primary/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-realtor-primary">
          AI beta
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={4}
          maxLength={1600}
          placeholder="Example: 2,200 sqft detached home in Hamilton, occupied, basement included, realtor wants photos, iGUIDE, drone, and maybe a reel for Instagram."
          className="realtor-field w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-light/60"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={recommend}
            disabled={pending || description.trim().length < 8}
            className="rounded-md bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Thinking..." : "Recommend my package"}
          </button>
          <p className="text-xs text-realtor-muted">
            You can still edit the selection manually after applying it.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      {recommendation ? (
        <div className="realtor-elevated-panel mt-4 rounded-xl p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-realtor-muted">
                Recommended
              </p>
              <h4 className="mt-1 text-base font-semibold text-realtor-text">
                {recommendation.title}
              </h4>
              {selectedNames.length > 0 ? (
                <p className="mt-1 text-xs font-semibold text-realtor-primary">
                  {selectedNames.join(" + ")}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-realtor-muted">
                {recommendation.reasoning}
              </p>
            </div>
            <span className="rounded-full border border-emerald-700/30 bg-emerald-700/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              {recommendation.confidence} fit
            </span>
          </div>

          {recommendation.notes.length > 0 ? (
            <ul className="mt-3 grid gap-1 text-xs text-realtor-muted md:grid-cols-2">
              {recommendation.notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span className="text-realtor-primary">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => applyRecommendation()}
              className="rounded-md bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary-light"
            >
              Apply this package
            </button>
            <p className="text-xs text-realtor-muted">
              This selects the package below and keeps you on this page.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
