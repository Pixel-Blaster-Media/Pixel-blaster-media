import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";

import BusinessSettingsForm from "./BusinessSettingsForm";

export const metadata = { title: "Business Settings" };
export const dynamic = "force-dynamic";

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  logo_url: string | null;
}

export default async function BusinessSettingsPage() {
  const admin = await requireAdmin();
  const service = getServiceSupabase();
  const { data: organization, error } = await service
    .from("organizations")
    .select("id, name, slug, primary_color, accent_color, logo_url")
    .eq("id", admin.organizationId)
    .maybeSingle<OrganizationRow>();

  if (error || !organization) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/settings"
          className="rounded-full border border-realtor-primary/15 bg-realtor-surface px-3 py-1.5 text-xs font-semibold text-realtor-muted transition hover:border-realtor-primary/35 hover:text-realtor-primary"
        >
          Back to settings
        </Link>
      </div>

      <header className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-lg shadow-realtor-text/10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-realtor-primary/80">
          Settings
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-realtor-text md:text-3xl">
          Business profile
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-realtor-muted">
          The company-level identity for this booking system. This is the
          foundation for letting other photography companies run their own
          version later.
        </p>
      </header>

      <BusinessSettingsForm organization={organization} />
    </div>
  );
}
