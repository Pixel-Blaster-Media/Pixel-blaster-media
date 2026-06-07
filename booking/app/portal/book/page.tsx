import type { Metadata } from "next";
import Link from "next/link";

import type { CatalogItemDTO } from "@/app/_components/CartPicker";
import { requireUser } from "@/lib/auth/require-user";
import {
  getActiveCatalog,
  type CatalogItemRow,
} from "@/lib/booking/catalog";
import {
  formatSlotLabel,
  loadSlotsForNextDays,
} from "@/lib/booking/slot-display";
import AwayNotice from "@/app/book/_components/AwayNotice";

import BookingConfirmForm from "./BookingConfirmForm";
import ServicePicker from "./ServicePicker";
import SlotPicker from "./SlotPicker";

export const metadata: Metadata = { title: "Book a shoot" };
export const dynamic = "force-dynamic";

export default async function PortalBookPage({
  searchParams,
}: {
  searchParams: Promise<{
    services?: string;
    add_ons?: string;
    slot?: string;
    street_address?: string;
    city?: string;
    postal_code?: string;
    square_footage?: string;
    repeat?: string;
    from_property?: string;
  }>;
}) {
  const params = await searchParams;
  const user = await requireUser("/portal/book");
  const catalog = await getActiveCatalog({ organizationId: user.organizationId });

  const bundles = catalog.bundles.map(toDTO);
  const aLaCarte = catalog.aLaCarte.map(toDTO);
  const addons = catalog.addons.map(toDTO);

  const validBundleSlugs = new Set(bundles.map((b) => b.slug));
  const validALaCarteSlugs = new Set(aLaCarte.map((a) => a.slug));
  const validAddonSlugs = new Set(addons.map((a) => a.slug));

  const rawServices = parseCsv(params.services);
  const rawAddOns = parseCsv(params.add_ons);

  // Service = bundle OR à la carte slug. Reject anything not in the
  // catalog so stale URLs don't crash subsequent lookups.
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
  // Strip addons that require video when the cart has none.
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

  const selectedSlot = params.slot ?? null;
  const daysOfSlots =
    selectedSlugs.length > 0
      ? await loadSlotsForNextDays(duration, 28, {
          organizationId: user.organizationId,
        })
      : [];

  const whenLabel = selectedSlot ? formatSlotLabel(new Date(selectedSlot)) : null;

  const selectedLabel = selectedItems.map((it) => it.name).join(", ");
  const repeatAddress = [params.street_address, params.city]
    .filter(Boolean)
    .join(", ");
  const isRepeatBooking = params.repeat === "1" && Boolean(repeatAddress);

  return (
    <div className="realtor-theme space-y-10">
      <Link href="/portal" className="text-xs text-realtor-muted hover:text-realtor-text">
        ← My listings
      </Link>

      <header>
        <h1 className="text-3xl font-bold text-realtor-text">Book a shoot</h1>
        <p className="mt-2 text-sm text-realtor-muted">
          Pick what you need, find a time, confirm. Confirmed bookings land
          directly on the photographer&apos;s calendar — no back-and-forth.
        </p>
      </header>

      {isRepeatBooking ? (
        <section className="realtor-green-panel rounded-3xl p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary">
            Book again
          </p>
          <h2 className="mt-2 text-xl font-semibold text-realtor-text">
            Starting from {repeatAddress}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-realtor-muted">
            We prefilled the services and property details from the last shoot.
            Pick a new time below, and change anything before confirming.
          </p>
        </section>
      ) : null}

      <section className="realtor-elevated-panel rounded-3xl p-5">
        <ServicePicker
          selectedSlugs={selectedSlugs}
          selectedAddOnSlugs={filteredAddOnSlugs}
          bundles={bundles}
          aLaCarte={aLaCarte}
          addons={addons}
        />
        {selectedSlugs.length > 0 ? (
          <p className="mt-5 rounded-2xl border border-realtor-primary/10 bg-realtor-surface/55 p-3 text-xs text-realtor-muted">
            On-site: <span className="text-realtor-text">~{duration} min</span>
            {" · "}
            <span className="text-realtor-text">
              ${(totalPriceCents / 100).toFixed(0)}
            </span>
            {" · "}
            {selectedLabel}
          </p>
        ) : null}
      </section>

      {selectedSlugs.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-primary">
            Pick a time
          </h2>
          <div className="mt-4 space-y-4">
            <AwayNotice />
            <SlotPicker
              selectedSlot={selectedSlot}
              daysOfSlots={daysOfSlots}
            />
          </div>
        </section>
      ) : null}

      {selectedSlot && whenLabel && selectedSlugs.length > 0 ? (
        <section className="realtor-green-panel rounded-3xl p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-primary">
            Property details
          </h2>
          <div className="mt-4">
            <BookingConfirmForm
              serviceSlugs={selectedSlugs}
              addOnSlugs={filteredAddOnSlugs}
              slot={selectedSlot}
              whenLabel={whenLabel}
              initial={{
                streetAddress: params.street_address ?? "",
                city: params.city ?? "Hamilton",
                postalCode: params.postal_code ?? "",
                squareFootage: params.square_footage ?? "",
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
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

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
