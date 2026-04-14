import type { Metadata } from "next";

import { ADD_ONS, SERVICES } from "@/lib/booking/services";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import PriceRow from "./PriceRow";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

type PriceRowType = Database["public"]["Tables"]["service_prices"]["Row"];

export default async function PricingPage() {
  const supabase = getServerSupabase();
  const { data: prices } = await supabase
    .from("service_prices")
    .select("service_id, price_cents, taxable, updated_at, updated_by")
    .returns<PriceRowType[]>();

  const byId = new Map((prices ?? []).map((p) => [p.service_id, p]));

  return (
    <div className="space-y-10">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Settings
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">Pricing</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Prices used on the QuickBooks invoice when you click &quot;Send
          invoice&quot; on a booking. Any service at $0 will block invoicing —
          set a real number before running your first invoice.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          Services
        </h2>
        <ul className="mt-4 divide-y divide-white/5 rounded-lg border border-white/10 bg-ink-soft/50">
          {SERVICES.map((s) => {
            const row = byId.get(s.id);
            return (
              <li key={s.id} className="p-4">
                <PriceRow
                  serviceId={s.id}
                  label={s.label}
                  blurb={s.blurb}
                  priceCents={row?.price_cents ?? 0}
                  taxable={row?.taxable ?? true}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          Add-ons
        </h2>
        <ul className="mt-4 divide-y divide-white/5 rounded-lg border border-white/10 bg-ink-soft/50">
          {ADD_ONS.map((a) => {
            const row = byId.get(a.id);
            return (
              <li key={a.id} className="p-4">
                <PriceRow
                  serviceId={a.id}
                  label={a.label}
                  blurb={a.blurb}
                  priceCents={row?.price_cents ?? 0}
                  taxable={row?.taxable ?? true}
                />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
