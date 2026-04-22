import type { Metadata } from "next";

import { getActiveCatalog } from "@/lib/booking/catalog";

import BookingForm from "./BookingForm";

export const metadata: Metadata = {
  title: "Book a Shoot",
  description:
    "Request a real estate photography, iGuide virtual tour, or floor plan shoot with Pixel Blaster Media.",
};

export const dynamic = "force-dynamic";

export default async function BookPage() {
  const catalog = await getActiveCatalog();

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
          Tell us what you need and when. We confirm the date by email within
          24 hours. No payment is taken at booking.
        </p>
      </header>

      <BookingForm
        bundles={catalog.bundles.map(toDTO)}
        aLaCarte={catalog.aLaCarte.map(toDTO)}
        addons={catalog.addons.map(toDTO)}
      />
    </div>
  );
}

// Narrow the full DB row to the DTO the picker cares about, so future
// catalog_items columns don't leak to the client bundle.
function toDTO(r: {
  id: string;
  slug: string;
  name: string;
  description: string;
  duration_minutes: number;
  price_cents: number;
  kind: "bundle" | "a_la_carte" | "addon";
  is_video: boolean;
  require_has_video: boolean;
  display_order: number;
}) {
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
