import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getFullCatalog, type CatalogItemRow } from "@/lib/booking/catalog";
import {
  getFullCatalogExamples,
  getReusableCatalogVideos,
  type CatalogItemExampleAdminRow,
  type ReusableCatalogVideo,
} from "@/lib/booking/catalog-examples";
import { isStreamConfigured } from "@/lib/booking/catalog-examples-core";
import type { CatalogItemKind } from "@/lib/supabase/database.types";

import CatalogItemEditor from "./PriceRow";
import NewItemForm from "./NewItemForm";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const admin = await requireAdmin();
  const [{ bundles, aLaCarte, addons }, examplesByItem, reusableVideos] = await Promise.all([
    getFullCatalog({ organizationId: admin.organizationId }),
    getFullCatalogExamples(admin.organizationId),
    getReusableCatalogVideos(admin.organizationId),
  ]);
  const streamConfigured = isStreamConfigured();

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
        examplesByItem={examplesByItem}
        reusableVideos={reusableVideos}
        streamConfigured={streamConfigured}
      />
      <Section
        kind="a_la_carte"
        title="A-La-Carte"
        blurb="Realtors can combine multiple with quantities. Durations stack into a single booking slot."
        items={aLaCarte}
        examplesByItem={examplesByItem}
        reusableVideos={reusableVideos}
        streamConfigured={streamConfigured}
      />
      <Section
        kind="addon"
        title="Add-ons"
        blurb='Toggled per booking. Mark "Only when cart has video" for add-ons like "put me on camera" so they hide unless the selection includes video.'
        items={addons}
        examplesByItem={examplesByItem}
        reusableVideos={reusableVideos}
        streamConfigured={streamConfigured}
      />
    </div>
  );
}

function Section({
  kind,
  title,
  blurb,
  items,
  examplesByItem,
  reusableVideos,
  streamConfigured,
}: {
  kind: CatalogItemKind;
  title: string;
  blurb: string;
  items: CatalogItemRow[];
  examplesByItem: Map<string, CatalogItemExampleAdminRow[]>;
  reusableVideos: ReusableCatalogVideo[];
  streamConfigured: boolean;
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
            <CatalogItemEditor
              item={it}
              examples={examplesByItem.get(it.id) ?? []}
              reusableVideos={reusableVideos}
              streamConfigured={streamConfigured}
            />
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
