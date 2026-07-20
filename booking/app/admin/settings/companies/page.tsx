import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getServiceSupabase } from "@/lib/supabase/server";

import BetaAdminMutationForm from "./BetaAdminMutationForm";
import CreateCompanyForm from "./CreateCompanyForm";
import IssueBetaInviteForm from "./IssueBetaInviteForm";

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  lifecycle_status: "onboarding" | "active" | "suspended";
  beta_invitation_id: string | null;
  created_at: string;
}

interface BetaInviteRow {
  id: string;
  email: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  organization_id: string | null;
  status: "issued" | "provisioning" | "completed" | "revoked" | "reconciliation_required";
  delivery_status: "pending" | "confirmed" | "unconfirmed";
  provisioning_deadline: string | null;
  created_at: string;
}

export default async function CompaniesSettingsPage() {
  await requirePlatformAdmin();

  const service = getServiceSupabase();
  const [organizationsResult, invitesResult] = await Promise.all([
    service
      .from("organizations")
      .select("id, name, slug, primary_color, accent_color, lifecycle_status, beta_invitation_id, created_at")
      .order("created_at", { ascending: true })
      .returns<OrganizationRow[]>(),
    service
      .from("beta_company_invites")
      .select("id, email, expires_at, consumed_at, revoked_at, organization_id, status, delivery_status, provisioning_deadline, created_at")
      .order("created_at", { ascending: false })
      .returns<BetaInviteRow[]>(),
  ]);
  if (organizationsResult.error) {
    throw new Error(`Failed to load companies: ${organizationsResult.error.message}`);
  }
  if (invitesResult.error) {
    throw new Error(`Failed to load beta invitations: ${invitesResult.error.message}`);
  }
  const organizations = organizationsResult.data;
  const invites = invitesResult.data;
  const completedInvitationIds = new Set(
    (invites ?? [])
      .filter((invite) => invite.status === "completed")
      .map((invite) => invite.id),
  );
  const activeInvitationIds = new Set(
    (organizations ?? [])
      .filter((organization) => organization.lifecycle_status === "active")
      .map((organization) => organization.beta_invitation_id)
      .filter((id): id is string => typeof id === "string"),
  );
  const betaInvitationsEnabled =
    process.env.BETA_COMPANY_ONBOARDING_ENABLED === "true";

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
                {org.lifecycle_status === "active" ? (
                  <Link
                    href={`/book?org=${org.slug}`}
                    className="rounded-full border border-realtor-primary/20 px-3 py-1.5 font-semibold text-realtor-primary transition hover:bg-realtor-primary/10"
                  >
                    Open booking link
                  </Link>
                ) : null}
                {org.lifecycle_status === "onboarding" &&
                org.beta_invitation_id &&
                completedInvitationIds.has(org.beta_invitation_id) ? (
                  <BetaAdminMutationForm kind="activate" id={org.id} />
                ) : null}
                <span className="rounded-full border border-realtor-primary/10 px-3 py-1.5 text-realtor-muted">
                  {org.lifecycle_status === "active" ? "Active" : org.lifecycle_status === "onboarding" ? "Needs review" : "Suspended"}
                </span>
                <span className="rounded-full border border-realtor-primary/10 px-3 py-1.5 text-realtor-muted">
                  Created {new Date(org.created_at).toLocaleDateString()}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {betaInvitationsEnabled ? (
        <IssueBetaInviteForm />
      ) : (
        <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 text-sm text-realtor-muted">
          Private beta invitation issuance is currently disabled.
        </section>
      )}

      {(invites?.length ?? 0) > 0 ? (
        <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-sm shadow-realtor-text/5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Recent beta invitations
          </p>
          <div className="mt-4 divide-y divide-realtor-primary/10">
            {(invites ?? []).map((invite) => {
              const status = betaInviteStatus(invite, activeInvitationIds);
              const canReconcile =
                invite.status === "reconciliation_required" ||
                (invite.status === "provisioning" &&
                  invite.provisioning_deadline !== null &&
                  new Date(invite.provisioning_deadline).getTime() <= Date.now());
              return (
                <div
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-semibold text-realtor-text">
                      {invite.email}
                    </p>
                    <p className="mt-1 text-xs text-realtor-muted">
                      {status.label} · Expires {new Date(invite.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  {canReconcile ? (
                    <BetaAdminMutationForm kind="reconcile" id={invite.id} />
                  ) : status.revocable ? (
                    <BetaAdminMutationForm kind="revoke" id={invite.id} />
                  ) : (
                    <span className="rounded-full border border-realtor-primary/15 px-3 py-1 text-xs font-semibold text-realtor-muted">
                      {status.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <details className="group rounded-2xl border border-realtor-primary/15 bg-realtor-surface/65 p-5">
        <summary className="cursor-pointer list-none text-sm font-semibold text-realtor-text">
          Manual company setup
          <span className="ml-2 text-xs font-normal text-realtor-muted">
            Use only when an owner cannot use beta onboarding
          </span>
        </summary>
        <div className="mt-5">
          <CreateCompanyForm />
        </div>
      </details>
    </div>
  );
}

function betaInviteStatus(
  invite: BetaInviteRow,
  activeInvitationIds: Set<string>,
): {
  label: string;
  revocable: boolean;
} {
  if (invite.status === "completed") {
    return {
      label: activeInvitationIds.has(invite.id) ? "Active" : "Needs activation",
      revocable: false,
    };
  }
  if (invite.status === "revoked") return { label: "Revoked", revocable: false };
  if (invite.status === "reconciliation_required") {
    return { label: "Needs reconciliation", revocable: false };
  }
  if (invite.status === "provisioning") {
    return { label: "Provisioning", revocable: false };
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return { label: "Expired", revocable: false };
  }
  if (invite.delivery_status === "unconfirmed") {
    return { label: "Delivery unconfirmed", revocable: true };
  }
  return { label: invite.delivery_status === "confirmed" ? "Invited" : "Pending delivery", revocable: true };
}
