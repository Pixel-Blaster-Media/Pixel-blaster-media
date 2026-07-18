import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getFullCatalog, type CatalogItemRow } from "@/lib/booking/catalog";
import type { CatalogItemKind } from "@/lib/supabase/database.types";

import CatalogItemEditor from "./PriceRow";
import NewItemForm from "./NewItemForm";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const admin = await requireAdmin();
  const { bundles, aLaCarte, addons } = await getFullCatalog({
    organizationId: admin.organizationId,
  });

  return (
    <div className="space-y-10">
      <header className="max-w-3xl">
        <Link
          href="/admin/settings"
          className="text-sm font-semibold text-realtor-primary hover:text-realtor-text"
        >
          ← Settings
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-realtor-text">
          Services & pricing
        </h1>
        <p className="mt-2 text-sm leading-6 text-realtor-muted">
          Manage what clients can book. Changes apply to new bookings only;
          existing jobs keep their original price.
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-realtor-primary">
          {title}
        </h2>
        <p className="text-xs text-realtor-muted">{blurb}</p>
      </div>
      <ul className="mt-4 divide-y divide-realtor-primary/10 rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85">
        {items.map((it) => (
          <li
            key={it.id}
            className={`p-4 ${it.active ? "" : "opacity-60"}`}
          >
            <CatalogItemEditor item={it} />
          </li>
        ))}
        {items.length === 0 ? (
          <li className="p-4 text-sm text-realtor-muted">
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
