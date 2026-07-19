import "server-only";

import { randomUUID } from "node:crypto";

import type { Json } from "@/lib/supabase/database.types";
import { getServiceSupabase } from "@/lib/supabase/server";

import {
  parseBookingIntegrationPayload,
  type BookingIntegrationPayload,
} from "./booking-job-payload";
import type { IntegrationJobType } from "./dispatcher-core";

export type { IntegrationJobType } from "./dispatcher-core";

export type IntegrationJobCompletionStatus =
  | "completed"
  | "skipped"
  | "retryable"
  | "dead_letter";

export interface ClaimedIntegrationJob {
  id: string;
  idempotencyKey: string;
  payload: BookingIntegrationPayload;
  dependencyResult: Json | null;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
}

export type IntegrationJobClaimResult =
  | { outcome: "claimed"; claim: ClaimedIntegrationJob }
  | { outcome: "not_claimable" }
  | { outcome: "claim_failed"; code: string };

export interface DueIntegrationJobIdentity {
  organizationId: string;
  bookingId: string;
  jobType: IntegrationJobType;
}

export type DueIntegrationJobsResult =
  | { outcome: "listed"; jobs: DueIntegrationJobIdentity[] }
  | { outcome: "list_failed"; code: string };

export async function listDueIntegrationJobs({
  limit,
  dispatchNotBefore,
}: {
  limit: number;
  dispatchNotBefore: string;
}): Promise<DueIntegrationJobsResult> {
  const { data, error } = await getServiceSupabase().rpc("list_due_integration_jobs", {
    p_limit: limit,
    p_dispatch_not_before: dispatchNotBefore,
  });
  if (error) {
    console.error("[integration-job] due list failed", { code: error.code });
    return { outcome: "list_failed", code: error.code };
  }
  if (!Array.isArray(data)) {
    return { outcome: "list_failed", code: "malformed_due_list" };
  }

  const jobs: DueIntegrationJobIdentity[] = [];
  for (const candidate of data) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { outcome: "list_failed", code: "malformed_due_identity" };
    }
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.organization_id !== "string" ||
      typeof row.booking_id !== "string" ||
      !isIntegrationJobType(row.job_type)
    ) {
      return { outcome: "list_failed", code: "malformed_due_identity" };
    }
    jobs.push({
      organizationId: row.organization_id,
      bookingId: row.booking_id,
      jobType: row.job_type,
    });
  }
  return { outcome: "listed", jobs };
}

export async function claimIntegrationJob({
  organizationId,
  bookingId,
  jobType,
  workerId,
}: {
  organizationId: string;
  bookingId: string;
  jobType: IntegrationJobType;
  workerId: string;
}): Promise<IntegrationJobClaimResult> {
  const leaseToken = randomUUID();
  const { data, error } = await getServiceSupabase().rpc("claim_integration_job", {
    p_organization_id: organizationId,
    p_booking_id: bookingId,
    p_job_type: jobType,
    p_worker_id: workerId,
    p_lease_token: leaseToken,
  });

  if (error) {
    console.error("[integration-job] claim failed", {
      code: error.code,
    });
    return { outcome: "claim_failed", code: error.code };
  }
  if (!data) return { outcome: "not_claimable" };
  if (typeof data !== "object" || Array.isArray(data)) {
    return { outcome: "claim_failed", code: "malformed_claim_response" };
  }

  const row = data as Record<string, Json | undefined>;
  if (
    typeof row.id !== "string" ||
    typeof row.lease_token !== "string"
  ) {
    console.error("[integration-job] malformed claim identity");
    return { outcome: "claim_failed", code: "malformed_claim_identity" };
  }
  if (
    typeof row.idempotency_key !== "string" ||
    typeof row.attempts !== "number" ||
    typeof row.max_attempts !== "number" ||
    row.organization_id !== organizationId ||
    row.booking_id !== bookingId ||
    row.job_type !== jobType ||
    row.payload_version !== 1 ||
    row.dependency_result === undefined
  ) {
    await deadLetterMalformedClaim({
      organizationId,
      jobId: row.id,
      leaseToken: row.lease_token,
      errorCode: "invalid_claim_envelope",
    });
    return { outcome: "claim_failed", code: "invalid_claim_envelope" };
  }

  const payload = parseBookingIntegrationPayload(row.payload);
  if (
    !payload ||
    payload.organization_id !== organizationId ||
    payload.booking_id !== bookingId
  ) {
    await deadLetterMalformedClaim({
      organizationId,
      jobId: row.id,
      leaseToken: row.lease_token,
      errorCode: "invalid_provider_payload",
    });
    return { outcome: "claim_failed", code: "invalid_provider_payload" };
  }

  return {
    outcome: "claimed",
    claim: {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      payload,
      dependencyResult: row.dependency_result ?? null,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      leaseToken: row.lease_token,
    },
  };
}

export async function finishIntegrationJob({
  organizationId,
  claim,
  status,
  providerExternalId,
  providerResult,
  errorCode,
  errorMessage,
  nextAttemptAt,
}: {
  organizationId: string;
  claim: ClaimedIntegrationJob;
  status: IntegrationJobCompletionStatus;
  providerExternalId?: string | null;
  providerResult?: Json;
  errorCode?: string | null;
  errorMessage?: string | null;
  nextAttemptAt?: string | null;
}): Promise<boolean> {
  const finalStatus =
    status === "retryable" && claim.attempts >= claim.maxAttempts
      ? "dead_letter"
      : status;
  const { data, error } = await getServiceSupabase().rpc("finish_integration_job", {
    p_organization_id: organizationId,
    p_job_id: claim.id,
    p_lease_token: claim.leaseToken,
    p_status: finalStatus,
    p_provider_external_id: providerExternalId ?? "",
    p_provider_result: providerResult ?? {},
    p_error_code: errorCode ?? "",
    p_error_message: errorMessage ?? "",
    p_next_attempt_at: nextAttemptAt ?? null,
  });

  if (error || data !== true) {
    console.error("[integration-job] completion persistence failed", {
      status: finalStatus,
      code: error?.code ?? "lease_mismatch",
    });
    return false;
  }
  return true;
}

async function deadLetterMalformedClaim({
  organizationId,
  jobId,
  leaseToken,
  errorCode,
}: {
  organizationId: string;
  jobId: string;
  leaseToken: string;
  errorCode: "invalid_claim_envelope" | "invalid_provider_payload";
}): Promise<void> {
  const { data, error } = await getServiceSupabase().rpc("finish_integration_job", {
    p_organization_id: organizationId,
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_status: "dead_letter",
    p_provider_external_id: "",
    p_provider_result: {},
    p_error_code: errorCode,
    p_error_message: "Claimed job failed runtime compatibility validation",
    p_next_attempt_at: null,
  });
  console.error("[integration-job] malformed claim rejected", {
    errorCode,
    settled: data === true && !error,
  });
}

function isIntegrationJobType(value: unknown): value is IntegrationJobType {
  return value === "quickbooks.invoice.create" ||
    value === "google_calendar.event.create" ||
    value === "email.booking.confirmation" ||
    value === "email.admin.new_booking" ||
    value === "push.admin.new_booking";
}
