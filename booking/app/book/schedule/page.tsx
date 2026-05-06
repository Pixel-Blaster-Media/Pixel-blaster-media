import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getActiveCatalog } from "@/lib/booking/catalog";
import { loadSlotsForNextDays } from "@/lib/booking/slot-display";
import {
  parseWizardState,
  stepCompleteness,
} from "@/lib/booking/wizard-state";

import Stepper from "../_components/Stepper";
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
  const c = stepCompleteness(state);
  if (!c.step1) redirect("/book");
  if (!c.step2) redirect(`/book/property?${serializeForRedirect(state)}`);

  // Compute slot duration from selected items (same logic as the
  // unified action) so the grid only shows times that fit.
  const catalog = await getActiveCatalog();
  const bySlug = new Map<string, (typeof catalog.bundles)[number]>();
  for (const r of catalog.bundles) bySlug.set(r.slug, r);
  for (const r of catalog.aLaCarte) bySlug.set(r.slug, r);
  for (const r of catalog.addons) bySlug.set(r.slug, r);

  const duration = Math.max(
    state.services.reduce((n, s) => n + (bySlug.get(s)?.duration_minutes ?? 0), 0) +
      state.addOns.reduce(
        (n, s) => n + (bySlug.get(s)?.duration_minutes ?? 0),
        0,
      ),
    60,
  );

  const daysOfSlots = await loadSlotsForNextDays(duration, 28);

  return (
    <>
      <Stepper current={3} state={state} />

      <section>
        <h2 className="text-lg font-semibold text-white md:text-xl">
          When works for you?
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Days with a green dot have openings. Pick a day to see its open
          times, then pick a time to move on.
        </p>
      </section>

      <CalendarPicker
        daysOfSlots={daysOfSlots}
        selectedSlot={state.slot}
      />
    </>
  );
}

function serializeForRedirect(state: ReturnType<typeof parseWizardState>) {
  const out = new URLSearchParams();
  if (state.services.length) out.set("services", state.services.join(","));
  if (state.addOns.length) out.set("add_ons", state.addOns.join(","));
  if (state.streetAddress) out.set("address", state.streetAddress);
  if (state.unitNumber) out.set("unit", state.unitNumber);
  if (state.city) out.set("city", state.city);
  if (state.postalCode) out.set("postal", state.postalCode);
  if (state.squareFootage != null)
    out.set("sqft", String(state.squareFootage));
  if (state.isVacant) out.set("vacant", state.isVacant);
  if (state.includeBasement != null) {
    out.set("basement", state.includeBasement ? "1" : "0");
  }
  if (state.shotRequests.length) out.set("shots", state.shotRequests.join(","));
  if (state.shootNotes) out.set("shoot_notes", state.shootNotes);
  return out.toString();
}
