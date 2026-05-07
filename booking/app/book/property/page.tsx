import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getActiveCatalog } from "@/lib/booking/catalog";
import {
  parseWizardState,
  stepCompleteness,
} from "@/lib/booking/wizard-state";

import Stepper from "../_components/Stepper";
import PropertyForm from "./PropertyForm";

export const metadata: Metadata = {
  title: "Book a shoot · property details",
};
export const dynamic = "force-dynamic";

export default async function BookStep2Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = parseWizardState(await searchParams);
  const catalog = await getActiveCatalog();

  // Guard — can't be here without step 1 done.
  if (!stepCompleteness(state).step1) {
    const qs = new URLSearchParams();
    redirect(`/book${qs.toString() ? `?${qs.toString()}` : ""}`);
  }

  return (
    <>
      <Stepper current={2} state={state} />

      <section>
        <h2 className="text-lg font-semibold text-realtor-text md:text-xl">
          Tell us about the property
        </h2>
        <p className="mt-1 text-sm text-realtor-muted">
          Start typing — we&apos;ll suggest full addresses. Add unit /
          square footage and a couple of on-site details so we show up
          prepared.
        </p>
      </section>

      <PropertyForm
        items={[...catalog.bundles, ...catalog.aLaCarte, ...catalog.addons].map(
          (item) => ({
            slug: item.slug,
            name: item.name,
            price_cents: item.price_cents,
            duration_minutes: item.duration_minutes,
            sqft_pricing_enabled: item.sqft_pricing_enabled,
            included_sqft: item.included_sqft,
            overage_increment_sqft: item.overage_increment_sqft,
            overage_price_cents: item.overage_price_cents,
          }),
        )}
        selectedSlugs={state.services}
        selectedAddOnSlugs={state.addOns}
        initial={{
          address: state.streetAddress,
          unit: state.unitNumber,
          city: state.city,
          postal: state.postalCode,
          sqft: state.squareFootage == null ? "" : String(state.squareFootage),
          vacant: state.isVacant ?? "",
          basement:
            state.includeBasement == null
              ? ""
              : state.includeBasement
                ? "1"
                : "0",
          shotRequests: state.shotRequests,
          shootNotes: state.shootNotes,
        }}
      />
    </>
  );
}
