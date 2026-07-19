import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";

import {
  markIntegrationJobReconciled,
  processIntegrationJobNow,
} from "./actions";

export const metadata: Metadata = { title: "Integration exceptions" };
export const dynamic = "force-dynamic";

interface OperatorJobRow {
  id: string;
  booking_id: string;
  job_type: string;
  status: "pending" | "processing" | "retryable" | "dead_letter";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
}

export default async function IntegrationJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const now = new Date();
  const overduePending = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();
  const { data, error } = await getServiceSupabase()
    .from("integration_jobs")
    .select(
      "id, booking_id, job_type, status, attempts, max_attempts, next_attempt_at, lease_expires_at, last_error_code, last_error_at, created_at, updated_at",
    )
    .eq("organization_id", admin.organizationId)
    .is("reconciled_at", null)
    .or(
      `status.eq.dead_letter,status.eq.retryable,and(status.eq.processing,lease_expires_at.lte.${nowIso}),and(status.eq.pending,next_attempt_at.lte.${overduePending})`,
    )
    .order("updated_at", { ascending: false })
    .limit(100)
    .returns<OperatorJobRow[]>();
  const jobs = data ?? [];

  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <header className="rounded-3xl border border-realtor-primary/15 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-realtor-primary/75">
              Exception-only operations
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-realtor-text">
              Integration jobs
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-realtor-muted">
              Only overdue, retryable, stale, or unresolved jobs appear here. Ambiguous
              provider results must be inspected before they are marked reconciled.
            </p>
          </div>
          <Link
            href="/admin/settings/integrations"
            className="rounded-full border border-realtor-primary/25 px-4 py-2 text-sm font-semibold text-realtor-primary"
          >
            Back to connections
          </Link>
        </div>
      </header>

      {params.error ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {params.error}
        </p>
      ) : null}
      {params.notice ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {params.notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Integration exceptions could not be loaded. Refresh to try again.
        </p>
      ) : null}

      {!error && jobs.length === 0 ? (
        <section className="rounded-3xl border border-realtor-primary/15 bg-white/90 p-8 text-center">
          <h2 className="text-lg font-semibold text-realtor-text">No integration exceptions</h2>
          <p className="mt-2 text-sm text-realtor-muted">There is nothing for an operator to review.</p>
        </section>
      ) : null}

      <section className="space-y-3">
        {jobs.map((job) => {
          const processable = isProcessableEmail(job, now.getTime());
          return (
            <article key={job.id} className="rounded-3xl border border-realtor-primary/15 bg-white/90 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={job.status} />
                    <span className="font-mono text-xs text-realtor-muted">{job.job_type}</span>
                  </div>
                  <Link
                    href={`/admin/bookings/${job.booking_id}`}
                    className="mt-2 block text-sm font-semibold text-realtor-primary hover:underline"
                  >
                    Booking {job.booking_id.slice(0, 8)}
                  </Link>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-realtor-muted">Attempts</dt>
                  <dd className="text-right font-mono text-realtor-text">{job.attempts}/{job.max_attempts}</dd>
                  <dt className="text-realtor-muted">Updated</dt>
                  <dd className="text-right text-realtor-text">{formatDate(job.updated_at)}</dd>
                  <dt className="text-realtor-muted">Error code</dt>
                  <dd className="text-right font-mono text-realtor-text">{job.last_error_code ?? "—"}</dd>
                </dl>
              </div>

              {processable ? (
                <form action={processIntegrationJobNow} className="mt-4">
                  <input type="hidden" name="job_id" value={job.id} />
                  <button className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white">
                    Process email now
                  </button>
                </form>
              ) : null}

              {job.status === "dead_letter" ? (
                <form action={markIntegrationJobReconciled} className="mt-4 grid gap-3 border-t border-realtor-primary/10 pt-4 md:grid-cols-[240px_1fr_auto]">
                  <input type="hidden" name="job_id" value={job.id} />
                  <label className="grid gap-1 text-xs font-semibold text-realtor-muted">
                    Reconciliation category
                    <select name="category" required className="rounded-xl border border-realtor-primary/20 bg-white px-3 py-2 text-sm text-realtor-text">
                      <option value="">Choose…</option>
                      <option value="provider_confirmed_completed">Provider confirmed completed</option>
                      <option value="provider_confirmed_absent">Provider confirmed absent</option>
                      <option value="duplicate_resolved">Duplicate resolved</option>
                      <option value="accepted_manual_resolution">Accepted manual resolution</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-realtor-muted">
                    Required operator note
                    <textarea name="note" minLength={10} maxLength={2000} required rows={2} className="rounded-xl border border-realtor-primary/20 bg-white px-3 py-2 text-sm text-realtor-text" />
                  </label>
                  <button className="self-end rounded-full border border-realtor-primary/30 px-4 py-2 text-sm font-semibold text-realtor-primary">
                    Mark reconciled
                  </button>
                </form>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}

function isProcessableEmail(job: OperatorJobRow, now: number): boolean {
  const isEmail = job.job_type === "email.booking.confirmation" ||
    job.job_type === "email.admin.new_booking";
  const due = new Date(job.next_attempt_at).getTime() <= now;
  return isEmail && due && (
    job.status === "pending" ||
    (job.status === "retryable" &&
      new Date(job.created_at).getTime() > now - 23 * 60 * 60 * 1000)
  );
}

function StatusBadge({ status }: { status: OperatorJobRow["status"] }) {
  const tone = status === "dead_letter"
    ? "border-red-200 bg-red-50 text-red-800"
    : status === "retryable"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{status.replace("_", " ")}</span>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
