import Link from "next/link";

import { requireAdmin } from "@/lib/auth/require-admin";

import AutoenhanceTestClient from "./AutoenhanceTestClient";

export const dynamic = "force-dynamic";

export default async function AutoenhanceTestPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div className="realtor-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary">
              Admin sandbox
            </p>
            <h1 className="mt-1 text-2xl font-bold text-realtor-text">
              Autoenhance API test
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-realtor-muted">
              Test Autoenhance orders, uploads, processing, and enhanced-image
              downloads without saving anything to bookings or realtor delivery.
            </p>
          </div>
          <Link
            href="/admin/settings/integrations"
            className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
          >
            Integrations
          </Link>
        </div>
      </div>
      <AutoenhanceTestClient />
    </div>
  );
}
