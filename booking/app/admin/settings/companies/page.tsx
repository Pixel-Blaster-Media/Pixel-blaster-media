import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getServiceSupabase } from "@/lib/supabase/server";

import CreateCompanyForm from "./CreateCompanyForm";

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  created_at: string;
}

export default async function CompaniesSettingsPage() {
  await requirePlatformAdmin();

  const service = getServiceSupabase();
  const { data: organizations, error } = await service
    .from("organizations")
    .select("id, name, slug, primary_color, accent_color, created_at")
    .order("created_at", { ascending: true })
    .returns<OrganizationRow[]>();

  if (error) {
    throw new Error(`Failed to load companies: ${error.message}`);
  }

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
          SaaS setup
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-realtor-text md:text-3xl">
          Companies
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-realtor-muted">
          Create a separate company workspace with its own booking handle,
          admin, catalog, business hours, and future integration connections.
          This is the on-ramp for turning Pixel Blaster into a multi-company
          platform.
        </p>
      </header>

      <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-sm shadow-realtor-text/5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
              Existing companies
            </p>
            <h2 className="mt-2 text-lg font-semibold text-realtor-text">
              {organizations?.length ?? 0} company workspace
              {(organizations?.length ?? 0) === 1 ? "" : "s"}
            </h2>
          </div>
          <span className="rounded-full border border-realtor-primary/20 bg-realtor-primary/10 px-3 py-1 text-xs font-semibold text-realtor-primary">
            Platform owner only
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(organizations ?? []).map((org) => (
            <article
              key={org.id}
              className="rounded-2xl border border-realtor-primary/12 bg-realtor-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-realtor-text">
                    {org.name}
                  </h3>
                  <p className="mt-1 text-xs text-realtor-muted">
                    /book?org={org.slug}
                  </p>
                </div>
                <span
                  className="h-8 w-8 rounded-full border border-realtor-primary/15"
                  style={{ backgroundColor: org.primary_color ?? "#3f7f5f" }}
                  aria-hidden="true"
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <Link
                  href={`/book?org=${org.slug}`}
                  className="rounded-full border border-realtor-primary/20 px-3 py-1.5 font-semibold text-realtor-primary transition hover:bg-realtor-primary/10"
                >
                  Open booking link
                </Link>
                <span className="rounded-full border border-realtor-primary/10 px-3 py-1.5 text-realtor-muted">
                  Created {new Date(org.created_at).toLocaleDateString()}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <CreateCompanyForm />
    </div>
  );
}
