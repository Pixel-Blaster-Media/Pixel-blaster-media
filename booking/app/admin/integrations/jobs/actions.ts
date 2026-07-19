"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";
import { dispatchBookingIntegrationJobs } from "@/lib/integrations/dispatcher";
import {
  buildIntegrationWorkerId,
  type IntegrationJobType,
} from "@/lib/integrations/dispatcher-core";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

const EMAIL_JOB_TYPES: readonly IntegrationJobType[] = [
  "email.booking.confirmation",
  "email.admin.new_booking",
];
const RECONCILIATION_CATEGORIES = [
  "provider_confirmed_completed",
  "provider_confirmed_absent",
  "duplicate_resolved",
  "accepted_manual_resolution",
] as const;

interface ProcessableJobRow {
  id: string;
  booking_id: string;
  job_type: IntegrationJobType;
  status: string;
  next_attempt_at: string;
  created_at: string;
}

export async function processIntegrationJobNow(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const jobId = field(formData, "job_id");
  if (!isUuid(jobId)) redirectWithError("Invalid integration job.");

  const { data: row, error } = await getServiceSupabase()
    .from("integration_jobs")
    .select("id, booking_id, job_type, status, next_attempt_at, created_at")
    .eq("id", jobId)
    .eq("organization_id", admin.organizationId)
    .maybeSingle<ProcessableJobRow>();
  if (error || !row) redirectWithError("Integration job not found.");

  const now = Date.now();
  const isEmail = row.job_type === "email.booking.confirmation" ||
    row.job_type === "email.admin.new_booking";
  const isDue = new Date(row.next_attempt_at).getTime() <= now;
  const isPending = row.status === "pending";
  const isSafeRetry = row.status === "retryable" &&
    new Date(row.created_at).getTime() > now - 23 * 60 * 60 * 1000;
  if (!isEmail || !isDue || (!isPending && !isSafeRetry)) {
    redirectWithError("Only due pending or safely retryable email jobs can be processed now.");
  }

  const results = await dispatchBookingIntegrationJobs({
    organizationId: admin.organizationId,
    bookingId: row.booking_id,
    workerId: buildIntegrationWorkerId("admin-process-now", randomUUID()),
    jobTypes: [row.job_type],
  });
  const outcome = results[0]?.outcome;
  revalidatePath("/admin/integrations/jobs");
  if (outcome === "completed" || outcome === "skipped") {
    redirectWithNotice("Email job processed.");
  }
  if (outcome === "retryable" || outcome === "dead_letter") {
    redirectWithNotice("Provider attempt recorded; review the updated exception.");
  }
  redirectWithError("The job could not be claimed or settled. Refresh before trying again.");
}

export async function markIntegrationJobReconciled(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const jobId = field(formData, "job_id");
  const category = field(formData, "category");
  const note = field(formData, "note");
  if (!isUuid(jobId)) redirectWithError("Invalid integration job.");
  if (!RECONCILIATION_CATEGORIES.includes(
    category as (typeof RECONCILIATION_CATEGORIES)[number],
  )) {
    redirectWithError("Choose a reconciliation category.");
  }
  if (note.length < 10 || note.length > 2000) {
    redirectWithError("Reconciliation note must be between 10 and 2000 characters.");
  }

  const supabase = await getServerSupabase();
  const rpcArgs: Database["public"]["Functions"]["reconcile_integration_job"]["Args"] = {
    p_organization_id: admin.organizationId,
    p_job_id: jobId,
    p_category: category,
    p_note: note,
  };
  // @supabase/ssr 0.5 loses newly-added RPC argument inference on its cookie
  // client; rpcArgs is still checked against the regenerated Database contract.
  const { data, error } = await supabase.rpc("reconcile_integration_job", rpcArgs as never);
  revalidatePath("/admin/integrations/jobs");
  if (error || data !== true) {
    redirectWithError("This exception was already reconciled or is not available.");
  }
  redirectWithNotice("Integration exception marked reconciled.");
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function redirectWithError(message: string): never {
  redirect(`/admin/integrations/jobs?error=${encodeURIComponent(message)}`);
}

function redirectWithNotice(message: string): never {
  redirect(`/admin/integrations/jobs?notice=${encodeURIComponent(message)}`);
}
