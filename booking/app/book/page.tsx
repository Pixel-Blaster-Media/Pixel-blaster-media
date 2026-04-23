import type { Metadata } from "next";

import type { CatalogItemDTO } from "@/app/_components/CartPicker";
import ServicePicker from "@/app/portal/book/ServicePicker";
import SlotPicker from "@/app/portal/book/SlotPicker";
import { getServerSupabase } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";
import {
  getActiveCatalog,
  type CatalogItemRow,
} from "@/lib/booking/catalog";
import {
  formatSlotLabel,
  loadSlotsForNextDays,
} from "@/lib/booking/slot-display";

import BookingConfirmForm from "./BookingConfirmForm";

export const metadata: Metadata = {
  title: "Book a Shoot",
  description:
    "Book a real estate photography, iGuide virtual tour, or floor plan shoot with Pixel Blaster Media.",
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

export default async function BookPage({
  searchParams,
}: {
  searchParams: { services?: string; add_ons?: string; slot?: string };
}) {
  const profile = await loadSessionProfile();
  const catalog = await getActiveCatalog();

  const bundles = catalog.bundles.map(toDTO);
  const aLaCarte = catalog.aLaCarte.map(toDTO);
  const addons = catalog.addons.map(toDTO);

  const validBundleSlugs = new Set(bundles.map((b) => b.slug));
  const validALaCarteSlugs = new Set(aLaCarte.map((a) => a.slug));
  const validAddonSlugs = new Set(addons.map((a) => a.slug));

  const rawServices = parseCsv(searchParams.services);
  const rawAddOns = parseCsv(searchParams.add_ons);

  const selectedSlugs = rawServices.filter(
    (s) => validBundleSlugs.has(s) || validALaCarteSlugs.has(s),
  );
  const selectedAddOnSlugs = rawAddOns.filter((s) => validAddonSlugs.has(s));

  const selectedItems = [
    ...selectedSlugs.map(
      (s) =>
        [...bundles, ...aLaCarte].find((it) => it.slug === s) ?? null,
    ),
    ...selectedAddOnSlugs.map(
      (s) => addons.find((it) => it.slug === s) ?? null,
    ),
  ].filter((x): x is CatalogItemDTO => !!x);

  const hasVideo = selectedItems.some((it) => it.is_video);
  const filteredAddOnSlugs = selectedAddOnSlugs.filter((slug) => {
    const addon = addons.find((a) => a.slug === slug);
    return !!addon && (!addon.require_has_video || hasVideo);
  });

  const totalDuration = selectedItems.reduce(
    (n, it) => n + it.duration_minutes,
    0,
  );
  const duration = Math.max(totalDuration, 60);
  const totalPriceCents = selectedItems.reduce(
    (n, it) => n + it.price_cents,
    0,
  );

  const selectedSlot = searchParams.slot ?? null;
  const daysOfSlots =
    selectedSlugs.length > 0 ? await loadSlotsForNextDays(duration, 28) : [];

  const whenLabel = selectedSlot ? formatSlotLabel(new Date(selectedSlot)) : null;
  const selectedLabel = selectedItems.map((it) => it.name).join(", ");

  return (
    <div className="space-y-10">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Realtors · Hamilton & GTA
        </p>
        <h1 className="mt-3 text-3xl font-bold text-white md:text-4xl">
          Book a shoot
        </h1>
        <p className="mt-3 text-ink-muted">
          Pick what you need, find a time, confirm. Your booking lands
          directly on our calendar — no approval wait.
        </p>
        {profile ? (
          <p className="mt-4 text-xs text-ink-muted">
            Signed in as{" "}
            <span className="text-white">
              {profile.fullName ?? profile.email}
            </span>
            .
          </p>
        ) : null}
      </header>

      <section className="rounded-xl border border-white/10 bg-ink-soft/50 p-5">
        <ServicePicker
          selectedSlugs={selectedSlugs}
          selectedAddOnSlugs={filteredAddOnSlugs}
          bundles={bundles}
          aLaCarte={aLaCarte}
          addons={addons}
        />
        {selectedSlugs.length > 0 ? (
          <p className="mt-5 border-t border-white/5 pt-4 text-xs text-ink-muted">
            On-site: <span className="text-white">~{duration} min</span>
            {" · "}
            <span className="text-white">
              ${(totalPriceCents / 100).toFixed(0)}
            </span>
            {" · "}
            {selectedLabel}
          </p>
        ) : null}
      </section>

      {selectedSlugs.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
            Pick a time
          </h2>
          <div className="mt-4">
            <SlotPicker
              selectedSlot={selectedSlot}
              daysOfSlots={daysOfSlots}
            />
          </div>
        </section>
      ) : null}

      {selectedSlot && whenLabel && selectedSlugs.length > 0 ? (
        <section className="rounded-xl border border-brand/20 bg-brand/5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
            {profile ? "Confirm your booking" : "Your details"}
          </h2>
          <div className="mt-4">
            <BookingConfirmForm
              serviceSlugs={selectedSlugs}
              addOnSlugs={filteredAddOnSlugs}
              slot={selectedSlot}
              whenLabel={whenLabel}
              profile={profile}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

async function loadSessionProfile(): Promise<SessionProfile | null> {
  const supabase = getServerSupabase();
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

function toDTO(r: CatalogItemRow): CatalogItemDTO {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    duration_minutes: r.duration_minutes,
    price_cents: r.price_cents,
    kind: r.kind,
    is_video: r.is_video,
    require_has_video: r.require_has_video,
    display_order: r.display_order,
  };
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
