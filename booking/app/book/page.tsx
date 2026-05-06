import type { Metadata } from "next";

import type { CatalogItemDTO } from "@/app/_components/CartPicker";
import {
  getActiveCatalog,
  type CatalogItemRow,
} from "@/lib/booking/catalog";
import { parseWizardState } from "@/lib/booking/wizard-state";

import AIPackageRecommender from "./_components/AIPackageRecommender";
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
  const catalog = await getActiveCatalog();

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
    <>
      <Stepper current={1} state={state} />

      <section>
        <h2 className="text-lg font-semibold text-white md:text-xl">
          What do you need?
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Pick a bundle or build it out a-la-carte. Video add-ons (like
          &ldquo;put me on camera&rdquo;) appear automatically when your
          selection includes video.
        </p>
      </section>

      <AIPackageRecommender
        bundles={bundles}
        aLaCarte={aLaCarte}
        addons={addons}
      />

      <PackageAccordion
        bundles={bundles}
        aLaCarte={aLaCarte}
        addons={addons}
        selectedSlugs={selectedSlugs}
        selectedAddOnSlugs={selectedAddOnSlugs}
      />
    </>
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
