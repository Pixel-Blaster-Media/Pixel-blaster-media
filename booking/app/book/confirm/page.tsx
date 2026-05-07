import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getActiveCatalog, getCatalogItemPrice } from "@/lib/booking/catalog";
import { formatSlotLabel } from "@/lib/booking/slot-display";
import {
  parseWizardState,
  stepCompleteness,
} from "@/lib/booking/wizard-state";
import { getServerSupabase } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

import Stepper from "../_components/Stepper";
import ConfirmForm from "./ConfirmForm";
import ConfirmUpsellPanel from "./ConfirmUpsellPanel";

export const metadata: Metadata = {
  title: "Book a shoot · confirm",
};
export const dynamic = "force-dynamic";

interface SessionProfile {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  brokerage: string | null;
  role: UserRole;
}

export default async function BookStep4Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = parseWizardState(await searchParams);
  const c = stepCompleteness(state);
  if (!c.step1) redirect("/book");
  if (!c.step2) redirect(`/book/property?${serializeForRedirect(state)}`);
  if (!c.step3) redirect(`/book/schedule?${serializeForRedirect(state)}`);

  const profile = await loadSessionProfile();
  const catalog = await getActiveCatalog();

  const bySlug = new Map<string, (typeof catalog.bundles)[number]>();
  for (const r of catalog.bundles) bySlug.set(r.slug, r);
  for (const r of catalog.aLaCarte) bySlug.set(r.slug, r);
  for (const r of catalog.addons) bySlug.set(r.slug, r);

  const selectedItems = state.services
    .map((s) => bySlug.get(s))
    .filter((x): x is NonNullable<typeof x> => !!x);
  const selectedAddons = state.addOns
    .map((s) => bySlug.get(s))
    .filter((x): x is NonNullable<typeof x> => !!x);

  const pricedItems = [...selectedItems, ...selectedAddons].map((item) => ({
    item,
    price: getCatalogItemPrice(item, state.squareFootage),
  }));
  const totalCents = pricedItems.reduce(
    (n, row) => n + row.price.totalPriceCents,
    0,
  );
  const duration = Math.max(
    selectedItems.reduce((n, i) => n + i.duration_minutes, 0) +
      selectedAddons.reduce((n, a) => n + a.duration_minutes, 0),
    60,
  );

  const whenLabel = state.slot ? formatSlotLabel(new Date(state.slot)) : "";
  const addressLine = [
    state.streetAddress,
    state.unitNumber && `Unit ${state.unitNumber}`,
    state.city,
    state.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <Stepper current={4} state={state} />

      <section>
        <h2 className="text-lg font-semibold text-realtor-text md:text-xl">
          Review + confirm
        </h2>
        {profile ? (
          <p className="mt-1 text-sm text-realtor-muted">
            Signed in as{" "}
            <span className="text-realtor-text">
              {profile.fullName ?? profile.email}
            </span>
            . One click and you&apos;re booked.
          </p>
        ) : (
          <p className="mt-1 text-sm text-realtor-muted">
            Enter your contact info and choose a password. That same password
            gets you back into your private portal later.
          </p>
        )}
      </section>

      <ConfirmUpsellPanel
        state={state}
        catalog={[...catalog.bundles, ...catalog.aLaCarte, ...catalog.addons].map(
          (item) => ({
            slug: item.slug,
            name: item.name,
            price_cents: item.price_cents,
            duration_minutes: item.duration_minutes,
            require_has_video: item.require_has_video,
          }),
        )}
      />

      {/* Summary */}
      <section className="realtor-elevated-panel rounded-3xl p-4 text-sm md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-realtor-primary/10 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
              Booking summary
            </p>
            <h3 className="mt-1 text-base font-semibold text-realtor-text">
              {addressLine}
            </h3>
          </div>
          <div className="rounded-2xl bg-realtor-surface-muted/70 px-4 py-3 text-right ring-1 ring-realtor-primary/10">
            <p className="text-xl font-semibold text-realtor-text">
              ${(totalCents / 100).toFixed(0)}
            </p>
            <p className="text-[11px] uppercase tracking-wider text-realtor-muted">
              ~{duration} min
            </p>
          </div>
        </div>

        <dl className="mt-4 grid gap-3">
          <Row
            label="Services"
            value={
              <span>
                {selectedItems.map((s) => s.name).join(", ")}
                {selectedAddons.length ? (
                  <span className="text-realtor-muted">
                    {" · "}
                    {selectedAddons.map((a) => a.name).join(", ")}
                  </span>
                ) : null}
              </span>
            }
          />
          <Row label="Address" value={addressLine} />
          {state.squareFootage != null ? (
            <Row label="Size" value={`${state.squareFootage} sqft (approx.)`} />
          ) : null}
          {state.isVacant ? (
            <Row
              label="Occupancy"
              value={
                state.isVacant === "vacant"
                  ? "Vacant"
                  : state.isVacant === "partial"
                    ? "Partially occupied"
                    : "Occupied"
              }
            />
          ) : null}
          {state.includeBasement != null ? (
            <Row
              label="Basement"
              value={state.includeBasement ? "Include in shoot" : "Skip"}
            />
          ) : null}
          {state.shotRequests.length || state.shootNotes ? (
            <Row
              label="Shot notes"
              value={
                <span className="space-y-1">
                  {state.shotRequests.length ? (
                    <span className="block">
                      {state.shotRequests.map(formatShotRequest).join(", ")}
                    </span>
                  ) : null}
                  {state.shootNotes ? (
                    <span className="block text-realtor-muted">
                      {state.shootNotes}
                    </span>
                  ) : null}
                </span>
              }
            />
          ) : null}
          <Row label="When" value={whenLabel} />
          {pricedItems.some((row) => row.price.overageCents > 0) ? (
            <Row
              label="Sqft pricing"
              value={
                <span className="space-y-1">
                  {pricedItems
                    .filter((row) => row.price.overageCents > 0)
                    .map((row) => (
                      <span key={row.item.id} className="block">
                        {row.item.name}: +$
                        {(row.price.overageCents / 100).toFixed(0)} for{" "}
                        {state.squareFootage?.toLocaleString()} sqft
                      </span>
                    ))}
                </span>
              }
            />
          ) : null}
        </dl>
        <p className="mt-3 border-t border-realtor-primary/10 pt-3 text-[11px] text-realtor-muted">
          Payment happens after the shoot. We&apos;ll adjust if the sqft or
          details need tweaking. Travel is included within roughly 30 km of
          the core service area; outside that, any travel fee is reviewed
          before invoicing.
        </p>
      </section>

      <ConfirmForm
        state={state}
        profile={profile}
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
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 rounded-2xl border border-realtor-primary/10 bg-realtor-surface/55 p-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[11px] uppercase tracking-wider text-realtor-muted">
        {label}
      </dt>
      <dd className="min-w-0 text-realtor-text/90">{value}</dd>
    </div>
  );
}

async function loadSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await getServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  let userId: string | null = null;
  try {
    const parts = session.access_token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { sub?: string; exp?: number };
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    userId = payload.sub ?? null;
  } catch {
    return null;
  }
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, phone, brokerage, role")
    .eq("id", userId)
    .maybeSingle<{
      id: string;
      email: string;
      full_name: string | null;
      phone: string | null;
      brokerage: string | null;
      role: UserRole;
    }>();
  if (!profile) return null;
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    phone: profile.phone,
    brokerage: profile.brokerage,
    role: profile.role,
  };
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

function formatShotRequest(slug: string): string {
  return (
    {
      pool: "Pool / backyard",
      view: "View / exterior",
      upgrades: "Upgrades / details",
      basement: "Basement",
      mechanicals: "Mechanicals",
      neighbourhood: "Neighbourhood",
    } satisfies Record<string, string>
  )[slug] ?? slug;
}
