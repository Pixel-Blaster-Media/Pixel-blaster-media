import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getActiveCatalog } from "@/lib/booking/catalog";
import { formatSlotLabel } from "@/lib/booking/slot-display";
import {
  parseWizardState,
  stepCompleteness,
} from "@/lib/booking/wizard-state";
import { getServerSupabase } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

import Stepper from "../_components/Stepper";
import ConfirmForm from "./ConfirmForm";

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

  const totalCents =
    selectedItems.reduce((n, i) => n + i.price_cents, 0) +
    selectedAddons.reduce((n, a) => n + a.price_cents, 0);
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
        <h2 className="text-lg font-semibold text-white md:text-xl">
          Review + confirm
        </h2>
        {profile ? (
          <p className="mt-1 text-sm text-ink-muted">
            Signed in as{" "}
            <span className="text-white">
              {profile.fullName ?? profile.email}
            </span>
            . One click and you&apos;re booked.
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">
            Create an account or sign in — your booking lands on both of our
            calendars automatically.
          </p>
        )}
      </section>

      {/* Summary */}
      <section className="rounded-xl border border-white/10 bg-ink-soft/50 p-4 text-sm">
        <dl className="space-y-2">
          <Row
            label="Services"
            value={
              <span>
                {selectedItems.map((s) => s.name).join(", ")}
                {selectedAddons.length ? (
                  <span className="text-ink-muted">
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
          <Row label="When" value={whenLabel} />
          <Row
            label="Total"
            value={
              <span>
                <span className="font-semibold text-white">
                  ${(totalCents / 100).toFixed(0)}
                </span>
                <span className="text-ink-muted">
                  {" · "}~{duration} min on-site
                </span>
              </span>
            }
          />
        </dl>
        <p className="mt-3 border-t border-white/5 pt-3 text-[11px] text-ink-muted">
          Payment happens after the shoot. We&apos;ll adjust if the sqft or
          details need tweaking. Travel is included within roughly 30 km of
          the core service area; outside that, any travel fee is reviewed
          before invoicing.
        </p>
      </section>

      <ConfirmForm state={state} profile={profile} />
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2">
      <dt className="w-24 shrink-0 text-[11px] uppercase tracking-wider text-ink-muted">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-white/90">{value}</dd>
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
  return out.toString();
}
