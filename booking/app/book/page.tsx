import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { CatalogItemDTO } from "@/app/_components/CartPicker";
import {
  getActiveCatalog,
  type CatalogItemRow,
} from "@/lib/booking/catalog";
import { parseWizardState } from "@/lib/booking/wizard-state";
import { resolvePublicBookingOrganization } from "@/lib/organizations/public-booking";

import AIPackageRecommender from "./_components/AIPackageRecommender";
import AwayNotice from "./_components/AwayNotice";
import BookingBrandHeader, {
  BookingBrandFrame,
} from "./_components/BookingBrandHeader";
import PackageAccordion from "./_components/PackageAccordion";
import Stepper from "./_components/Stepper";

export const metadata: Metadata = {
  title: "Book a shoot · pick your services",
};
export const dynamic = "force-dynamic";

export default async function BookStep1Page({
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

  const bundles = catalog.bundles.map(toDTO);
  const aLaCarte = catalog.aLaCarte.map(toDTO);
  const addons = catalog.addons.map(toDTO);

  // Only keep slugs that exist in the live catalog so a stale URL
  // doesn't show a phantom selection.
  const validBundleSlugs = new Set(bundles.map((b) => b.slug));
  const validALaCarteSlugs = new Set(aLaCarte.map((a) => a.slug));
  const validAddonSlugs = new Set(addons.map((a) => a.slug));

  const selectedSlugs = state.services.filter(
    (s) => validBundleSlugs.has(s) || validALaCarteSlugs.has(s),
  );
  const selectedAddOnSlugs = state.addOns.filter((s) => validAddonSlugs.has(s));

  return (
    <BookingBrandFrame organization={organization}>
      <BookingBrandHeader organization={organization} />
      <Stepper current={1} state={scopedState} />

      <AwayNotice />

      <AIPackageRecommender
        bundles={bundles}
        aLaCarte={aLaCarte}
        addons={addons}
        organizationSlug={organization.slug}
      />

      <PackageAccordion
        bundles={bundles}
        aLaCarte={aLaCarte}
        addons={addons}
        selectedSlugs={selectedSlugs}
        selectedAddOnSlugs={selectedAddOnSlugs}
        squareFootage={scopedState.squareFootage}
      />
    </BookingBrandFrame>
  );
}

function toDTO(r: CatalogItemRow): CatalogItemDTO {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    duration_minutes: r.duration_minutes,
    price_cents: r.price_cents,
    sqft_pricing_enabled: r.sqft_pricing_enabled,
    included_sqft: r.included_sqft,
    overage_increment_sqft: r.overage_increment_sqft,
    overage_price_cents: r.overage_price_cents,
    kind: r.kind,
    is_photo: r.is_photo,
    is_video: r.is_video,
    require_has_video: r.require_has_video,
    display_order: r.display_order,
    badge: r.badge,
    highlight: r.highlight,
    ideal_for: r.ideal_for,
  };
}
