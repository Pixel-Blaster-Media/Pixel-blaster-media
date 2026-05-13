import type { Metadata } from "next";
import Link from "next/link";

import { getFullCatalog, type CatalogItemRow } from "@/lib/booking/catalog";
import type { CatalogItemKind } from "@/lib/supabase/database.types";

import CatalogItemEditor from "./PriceRow";
import NewItemForm from "./NewItemForm";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const { bundles, aLaCarte, addons } = await getFullCatalog();

  return (
    <div className="space-y-10">
      <header className="rounded-2xl border border-white/10 bg-ink-soft/55 p-4 shadow-lg shadow-black/10">
        <Link
          href="/admin/settings"
          className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-light hover:text-white"
        >
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-white">Pricing</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Bundles, à la carte items, and add-ons shown on the booking form
          and invoiced via QuickBooks. Edits here take effect immediately
          for new bookings. Existing bookings keep whatever price was
          locked in at booking time.
        </p>
      </header>

      <Section
        kind="bundle"
        title="Bundles"
        blurb="Realtors pick one bundle. Duration + price are fixed."
        items={bundles}
      />
      <Section
        kind="a_la_carte"
        title="A-La-Carte"
        blurb="Realtors can combine multiple with quantities. Durations stack into a single booking slot."
        items={aLaCarte}
      />
      <Section
        kind="addon"
        title="Add-ons"
        blurb='Toggled per booking. Mark "Only when cart has video" for add-ons like "put me on camera" so they hide unless the selection includes video.'
        items={addons}
      />
    </div>
  );
}

function Section({
  kind,
  title,
  blurb,
  items,
}: {
  kind: CatalogItemKind;
  title: string;
  blurb: string;
  items: CatalogItemRow[];
}) {
  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          {title}
        </h2>
        <p className="text-xs text-ink-muted">{blurb}</p>
      </div>
      <ul className="mt-4 divide-y divide-white/5 rounded-2xl border border-white/10 bg-ink-soft/50">
        {items.map((it) => (
          <li
            key={it.id}
            className={`p-4 ${it.active ? "" : "opacity-60"}`}
          >
            <CatalogItemEditor item={it} />
          </li>
        ))}
        {items.length === 0 ? (
          <li className="p-4 text-sm text-ink-muted">
            Nothing here yet — add one below.
          </li>
        ) : null}
        <li>
          <NewItemForm kind={kind} />
        </li>
      </ul>
    </section>
  );
}
