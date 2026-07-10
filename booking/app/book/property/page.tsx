import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getActiveCatalog } from "@/lib/booking/catalog";
import {
  parseWizardState,
  serializeWizardState,
  stepCompleteness,
} from "@/lib/booking/wizard-state";
import { resolvePublicBookingOrganization } from "@/lib/organizations/public-booking";

import BookingBrandHeader, {
  BookingBrandFrame,
} from "../_components/BookingBrandHeader";
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
  const organization = await resolvePublicBookingOrganization(
    state.organizationSlug,
  );
  if (!organization) notFound();
  const scopedState = { ...state, organizationSlug: organization.slug };
  const catalog = await getActiveCatalog({ organizationId: organization.id });

  // Guard — can't be here without step 1 done.
  if (!stepCompleteness(scopedState).step1) {
    const qs = serializeWizardState({
      organizationSlug: scopedState.organizationSlug,
    });
    redirect(`/book${qs.toString() ? `?${qs.toString()}` : ""}`);
  }

  return (
    <BookingBrandFrame organization={organization}>
      <BookingBrandHeader organization={organization} compact />
      <Stepper current={2} state={scopedState} />

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
        selectedSlugs={scopedState.services}
        selectedAddOnSlugs={scopedState.addOns}
        initial={{
          address: scopedState.streetAddress,
          unit: scopedState.unitNumber,
          city: scopedState.city,
          postal: scopedState.postalCode,
          sqft:
            scopedState.squareFootage == null
              ? ""
              : String(scopedState.squareFootage),
          vacant: scopedState.isVacant ?? "",
          basement:
            scopedState.includeBasement == null
              ? ""
              : scopedState.includeBasement
                ? "1"
                : "0",
          shotRequests: scopedState.shotRequests,
          shootNotes: scopedState.shootNotes,
        }}
      />
    </BookingBrandFrame>
  );
}
