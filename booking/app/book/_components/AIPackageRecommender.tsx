"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { CatalogItemDTO } from "@/app/_components/CartPicker";
import {
  recommendBookingPackage,
  type BookingRecommendationContext,
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
  const paramsString = params.toString();
  const [description, setDescription] = useState("");
  const [recommendation, setRecommendation] =
    useState<BookingRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const bySlug = useMemo(() => {
    const m = new Map<string, CatalogItemDTO>();
    for (const item of [...bundles, ...aLaCarte, ...addons]) m.set(item.slug, item);
    return m;
  }, [bundles, aLaCarte, addons]);
  const currentContext = useMemo(
    () => readContextFromParams(new URLSearchParams(paramsString)),
    [paramsString],
  );
  const knownDetails = useMemo(
    () => contextSummary(currentContext, bySlug),
    [currentContext, bySlug],
  );

  function recommend() {
    setError(null);
    setRecommendation(null);
    startTransition(async () => {
      try {
        const result = await recommendBookingPackage({
          description,
          organizationSlug,
          context: currentContext,
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
    if (next.property.streetAddress) out.set("address", next.property.streetAddress);
    if (next.property.city) out.set("city", next.property.city);
    if (next.property.postalCode) out.set("postal", next.property.postalCode);
    if (next.property.squareFootage) {
      out.set("sqft", String(next.property.squareFootage));
    }
    if (next.property.isVacant) out.set("vacant", next.property.isVacant);
    if (next.property.includeBasement != null) {
      out.set("basement", next.property.includeBasement ? "1" : "0");
    }
    if (next.property.shootNotes) {
      out.set("shoot_notes", next.property.shootNotes);
    }
    if (next.property.shotRequests.length) {
      out.set("shots", next.property.shotRequests.join(","));
    }
    // If they already had a later-step choice, service changes can change duration.
    out.delete("slot");
    router.replace(`?${out.toString()}`, { scroll: false });
  }

  function applyAndContinue() {
    if (!recommendation) return;
    const out = new URLSearchParams(params.toString());
    out.set("services", recommendation.services.join(","));
    if (recommendation.addOns.length) {
      out.set("add_ons", recommendation.addOns.join(","));
    } else {
      out.delete("add_ons");
    }
    if (recommendation.property.streetAddress) {
      out.set("address", recommendation.property.streetAddress);
    }
    if (recommendation.property.city) out.set("city", recommendation.property.city);
    if (recommendation.property.postalCode) {
      out.set("postal", recommendation.property.postalCode);
    }
    if (recommendation.property.squareFootage) {
      out.set("sqft", String(recommendation.property.squareFootage));
    }
    if (recommendation.property.isVacant) {
      out.set("vacant", recommendation.property.isVacant);
    }
    if (recommendation.property.includeBasement != null) {
      out.set("basement", recommendation.property.includeBasement ? "1" : "0");
    }
    if (recommendation.property.shootNotes) {
      out.set("shoot_notes", recommendation.property.shootNotes);
    }
    if (recommendation.property.shotRequests.length) {
      out.set("shots", recommendation.property.shotRequests.join(","));
    }
    out.delete("slot");
    router.push(`/book/property?${out.toString()}`);
  }

  const selectedNames = recommendation
    ? [...recommendation.services, ...recommendation.addOns]
        .map((slug) => bySlug.get(slug)?.name)
        .filter(Boolean)
    : [];

  const panel = (
    <section className="realtor-green-panel rounded-3xl p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary">
            AI booking concierge
          </p>
          <h3 className="mt-1 text-lg font-semibold text-realtor-text">
            Tell us about the listing.
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-realtor-muted">
            We&apos;ll pick the cleanest package, explain the choice, fill in
            anything obvious, and show what still needs an answer.
          </p>
        </div>
        <span className="rounded-full border border-realtor-primary/30 bg-realtor-primary/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-realtor-primary">
          AI beta
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {PROMPT_STARTERS.map((starter) => (
          <button
            key={starter.label}
            type="button"
            onClick={() => {
              setDescription((current) =>
                current.trim()
                  ? `${current.trim()}\n${starter.text}`
                  : starter.text,
              );
            }}
            className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/70 px-3 py-2 text-left text-xs font-semibold text-realtor-text transition hover:border-realtor-primary/35 hover:bg-realtor-primary/10"
          >
            {starter.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={4}
          maxLength={1600}
          placeholder="Example: 2,200 sqft detached home in Burlington, occupied, finished basement included. They need MLS photos and floor plans, and they asked whether drone or a short reel makes sense."
          className="realtor-field min-h-32 w-full rounded-2xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-light/60"
        />
        {knownDetails.length > 0 ? (
          <div className="rounded-2xl border border-realtor-primary/10 bg-realtor-surface/60 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-primary">
              Already in the booking
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {knownDetails.map((detail) => (
                <span
                  key={detail}
                  className="rounded-full border border-realtor-primary/15 bg-white/70 px-2.5 py-1 text-xs text-realtor-muted"
                >
                  {detail}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={recommend}
            disabled={pending || description.trim().length < 8}
            className="rounded-md bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Thinking..." : "Build my booking plan"}
          </button>
          <p className="text-xs text-realtor-muted">
            The final choice stays editable. Nothing is booked until checkout.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      {recommendation ? (
        <div className="realtor-elevated-panel mt-4 rounded-3xl p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-realtor-muted">
                Recommended booking plan
              </p>
              <h4 className="mt-1 text-base font-semibold text-realtor-text">
                {recommendation.title}
              </h4>
              {selectedNames.length > 0 ? (
                <p className="mt-1 text-xs font-semibold text-realtor-primary">
                  {selectedNames.join(" + ")}
                </p>
              ) : null}
              <p className="mt-2 max-w-3xl text-sm leading-6 text-realtor-muted">
                {recommendation.reasoning}
              </p>
            </div>
            <span className="rounded-full border border-emerald-700/30 bg-emerald-700/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              {recommendation.confidence} fit
            </span>
          </div>

          {recommendation.notes.length > 0 ? (
            <ul className="mt-4 grid gap-2 text-sm text-realtor-muted md:grid-cols-2">
              {recommendation.notes.map((note) => (
                <li
                  key={note}
                  className="rounded-2xl border border-realtor-primary/10 bg-realtor-surface/60 px-3 py-2"
                >
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <InfoList
              title="We can prefill"
              empty="No property details found yet."
              items={prefillDetails(recommendation)}
            />
            <InfoList
              title="Ask before checkout"
              empty="Nothing obvious missing."
              items={recommendation.missingInfo}
            />
          </div>

          {recommendation.memoryUsed.length > 0 ? (
            <div className="mt-3 rounded-2xl border border-emerald-700/15 bg-emerald-700/5 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                Realtor memory helped
              </p>
              <ul className="mt-1 grid gap-1 text-xs text-realtor-muted md:grid-cols-2">
                {recommendation.memoryUsed.map((memory) => (
                  <li key={memory} className="flex gap-2">
                    <span className="text-emerald-700">•</span>
                    <span>{memory}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => applyRecommendation()}
              className="rounded-md bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary-light"
            >
              Use this plan
            </button>
            <button
              type="button"
              onClick={applyAndContinue}
              className="rounded-md border border-realtor-primary/25 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:bg-realtor-primary/5"
            >
              Use plan + enter property
            </button>
            <p className="text-xs text-realtor-muted">
              You can still edit everything before confirming.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );

  return (
    <>
      {assistantOpen ? (
        <section
          className="fixed inset-x-3 z-[80] max-h-[78vh] overflow-y-auto rounded-3xl border border-realtor-primary/20 bg-[#fffdf8] p-3 shadow-2xl shadow-realtor-text/25 md:inset-x-auto md:right-6 md:w-[520px]"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.75rem)",
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-realtor-primary">
              Optional helper
            </p>
            <button
              type="button"
              onClick={() => setAssistantOpen(false)}
              className="rounded-full border border-realtor-primary/15 px-3 py-1 text-xs font-semibold text-realtor-muted transition hover:text-realtor-primary"
            >
              Close
            </button>
          </div>
          {panel}
        </section>
      ) : null}

      {!assistantOpen ? (
        <button
          type="button"
          onClick={() => setAssistantOpen(true)}
          className="fixed z-[80] flex h-12 w-12 items-center justify-center rounded-full border border-realtor-primary/20 bg-realtor-primary text-xs font-bold text-white shadow-2xl shadow-realtor-text/30 transition hover:scale-105 hover:bg-realtor-primary-light sm:h-14 sm:w-14 sm:text-sm"
          style={{
            right: "calc(env(safe-area-inset-right, 0px) + 0.75rem)",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
          }}
          aria-label="Open AI booking concierge"
        >
          AI
        </button>
      ) : null}
    </>
  );
}

const PROMPT_STARTERS = [
  {
    label: "Standard MLS listing",
    text: "This is a regular MLS listing. They need clean photos and the basics done well.",
  },
  {
    label: "Big or premium home",
    text: "This is a larger or higher-end property. They want it to feel polished and premium.",
  },
  {
    label: "Needs floor plans",
    text: "They need measurements, floor plans, or an iGUIDE-style tour.",
  },
  {
    label: "Social/video matters",
    text: "They care about social media or video, but I want the recommendation to stay practical.",
  },
];

function InfoList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: string[];
}) {
  return (
    <div className="rounded-2xl border border-realtor-primary/10 bg-realtor-surface/55 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-primary">
        {title}
      </p>
      {items.length > 0 ? (
        <ul className="mt-1 space-y-1 text-xs text-realtor-muted">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-realtor-muted">{empty}</p>
      )}
    </div>
  );
}

function readContextFromParams(params: URLSearchParams): BookingRecommendationContext {
  return {
    selectedServices: csv(params.get("services")),
    selectedAddOns: csv(params.get("add_ons")),
    streetAddress: clean(params.get("address")),
    city: clean(params.get("city")),
    postalCode: clean(params.get("postal")),
    squareFootage: intOrNull(params.get("sqft")),
    isVacant: vacancy(params.get("vacant")),
    includeBasement: boolOrNull(params.get("basement")),
    shootNotes: clean(params.get("shoot_notes")),
    shotRequests: csv(params.get("shots")),
  };
}

function contextSummary(
  context: BookingRecommendationContext,
  bySlug: Map<string, CatalogItemDTO>,
): string[] {
  return [
    context.streetAddress,
    context.city,
    context.squareFootage
      ? `${context.squareFootage.toLocaleString()} sqft`
      : null,
    context.isVacant ? formatVacancy(context.isVacant) : null,
    context.includeBasement != null
      ? context.includeBasement
        ? "Basement included"
        : "No basement"
      : null,
    ...context.selectedServices
      .map((slug) => bySlug.get(slug)?.name)
      .filter((name): name is string => Boolean(name)),
  ].filter((item): item is string => Boolean(item));
}

function prefillDetails(recommendation: BookingRecommendation): string[] {
  const p = recommendation.property;
  return [
    p.streetAddress ? `Address: ${p.streetAddress}` : null,
    p.city ? `City: ${p.city}` : null,
    p.postalCode ? `Postal: ${p.postalCode}` : null,
    p.squareFootage ? `Square footage: ${p.squareFootage.toLocaleString()}` : null,
    p.isVacant ? `Occupancy: ${formatVacancy(p.isVacant)}` : null,
    p.includeBasement != null
      ? `Basement: ${p.includeBasement ? "include it" : "skip it"}`
      : null,
    p.shootNotes ? "Shoot notes drafted" : null,
    p.shotRequests.length ? `${p.shotRequests.length} shot request tags` : null,
  ].filter((item): item is string => Boolean(item));
}

function csv(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function intOrNull(value: string | null): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function boolOrNull(value: string | null): boolean | null {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

function vacancy(value: string | null): "vacant" | "occupied" | "partial" | null {
  if (value === "vacant" || value === "occupied" || value === "partial") {
    return value;
  }
  return null;
}

function formatVacancy(value: "vacant" | "occupied" | "partial") {
  if (value === "vacant") return "vacant";
  if (value === "partial") return "partially occupied";
  return "occupied";
}
