import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { CatalogItemDTO } from "@/lib/booking/catalog-dto";
import {
  getSelectedServiceCapabilities,
  isCatalogAddonEligible,
} from "@/lib/booking/catalog-eligibility";
import {
  getActiveCatalog,
  type CatalogItemRow,
} from "@/lib/booking/catalog";
import { parseWizardState } from "@/lib/booking/wizard-state";
import { resolvePublicBookingOrganization } from "@/lib/organizations/public-booking";

import AIPackageRecommender from "./_components/AIPackageRecommender";
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
  const rawSearchParams = await searchParams;
  const state = parseWizardState(rawSearchParams);
  const selectionNoticeRequested =
    rawSearchParams.selection_notice === "addon_changed";
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
  const selectedCapabilities = getSelectedServiceCapabilities(
    [...bundles, ...aLaCarte].filter((item) =>
      selectedSlugs.includes(item.slug),
    ),
  );
  const selectedAddOnSlugs = state.addOns.filter((slug) => {
    if (!validAddonSlugs.has(slug)) return false;
    const addon = addons.find((item) => item.slug === slug);
    return Boolean(
      addon && isCatalogAddonEligible(addon, selectedCapabilities),
    );
  });
  const selectionNotice =
    selectionNoticeRequested ||
    selectedSlugs.length !== state.services.length ||
    selectedAddOnSlugs.length !== state.addOns.length
      ? "An add-on or service was removed because it is no longer available with the selected services."
      : null;

  return (
    <BookingBrandFrame organization={organization}>
      <BookingBrandHeader organization={organization} />
      <Stepper current={1} state={scopedState} />

      {selectionNotice ? (
        <p role="status" className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {selectionNotice}
        </p>
      ) : null}

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
    is_iguide: r.is_iguide,
    is_aerial: r.is_aerial,
    require_has_video: r.require_has_video,
    require_has_media: r.require_has_media,
    exclude_has_aerial: r.exclude_has_aerial,
    display_order: r.display_order,
    badge: r.badge,
    highlight: r.highlight,
    ideal_for: r.ideal_for,
  };
}
