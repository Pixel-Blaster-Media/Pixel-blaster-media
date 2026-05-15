import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getActiveCatalog } from "@/lib/booking/catalog";
import { loadSlotsForNextDays } from "@/lib/booking/slot-display";
import {
  parseWizardState,
  serializeWizardState,
  stepCompleteness,
} from "@/lib/booking/wizard-state";
import { resolvePublicBookingOrganization } from "@/lib/organizations/public-booking";

import Stepper from "../_components/Stepper";
import BookingTotalBar from "../_components/BookingTotalBar";
import CalendarPicker from "./CalendarPicker";

export const metadata: Metadata = {
  title: "Book a shoot · pick a time",
};
export const dynamic = "force-dynamic";

export default async function BookStep3Page({
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
  const c = stepCompleteness(scopedState);
  if (!c.step1) redirect(`/book?${serializeForRedirect(scopedState)}`);
  if (!c.step2) redirect(`/book/property?${serializeForRedirect(scopedState)}`);

  // Compute slot duration from selected items (same logic as the
  // unified action) so the grid only shows times that fit.
  const catalog = await getActiveCatalog({ organizationId: organization.id });
  const bySlug = new Map<string, (typeof catalog.bundles)[number]>();
  for (const r of catalog.bundles) bySlug.set(r.slug, r);
  for (const r of catalog.aLaCarte) bySlug.set(r.slug, r);
  for (const r of catalog.addons) bySlug.set(r.slug, r);

  const duration = Math.max(
    scopedState.services.reduce(
      (n, s) => n + (bySlug.get(s)?.duration_minutes ?? 0),
      0,
    ) +
      scopedState.addOns.reduce(
        (n, s) => n + (bySlug.get(s)?.duration_minutes ?? 0),
        0,
      ),
    60,
  );

  const daysOfSlots = await loadSlotsForNextDays(duration, 28, {
    organizationId: organization.id,
  });

  return (
    <>
      <Stepper current={3} state={scopedState} />

      <section>
        <h2 className="text-lg font-semibold text-realtor-text md:text-xl">
          When works for you?
        </h2>
        <p className="mt-1 text-sm text-realtor-muted">
          Days with a green dot have openings. Pick a day to see its open
          times, then pick a time to move on.
        </p>
      </section>

      <CalendarPicker
        daysOfSlots={daysOfSlots}
        selectedSlot={scopedState.slot}
      />

      <BookingTotalBar
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
        squareFootage={scopedState.squareFootage}
        href={
          scopedState.slot
            ? `/book/confirm?${serializeForRedirect(scopedState)}`
            : undefined
        }
        disabled={!scopedState.slot}
        ctaLabel={scopedState.slot ? "Continue" : "Pick a time"}
      />
    </>
  );
}

function serializeForRedirect(state: ReturnType<typeof parseWizardState>) {
  return serializeWizardState(state).toString();
}
