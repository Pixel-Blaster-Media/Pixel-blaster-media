import "server-only";

import { randomUUID } from "node:crypto";

import type { Json } from "@/lib/supabase/database.types";
import { getServiceSupabase } from "@/lib/supabase/server";

import {
  parseBookingIntegrationPayload,
  type BookingIntegrationPayload,
} from "./booking-job-payload";

export type IntegrationJobType =
  | "quickbooks.invoice.create"
  | "google_calendar.event.create"
  | "email.booking.confirmation"
  | "email.admin.new_booking"
  | "push.admin.new_booking";

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

export async function claimIntegrationJob({
  organizationId,
  bookingId,
  jobType,
}: {
  organizationId: string;
  bookingId: string;
  jobType: IntegrationJobType;
}): Promise<ClaimedIntegrationJob | null> {
  const leaseToken = randomUUID();
  const workerId = `inline-public-booking:${randomUUID()}`;
  const { data, error } = await getServiceSupabase().rpc("claim_integration_job", {
    p_organization_id: organizationId,
    p_booking_id: bookingId,
    p_job_type: jobType,
    p_worker_id: workerId,
    p_lease_token: leaseToken,
  });

  if (error) {
    console.error("[integration-job] claim failed", {
      bookingId,
      jobType,
      code: error.code,
    });
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const row = data as Record<string, Json | undefined>;
  if (
    typeof row.id !== "string" ||
    typeof row.lease_token !== "string"
  ) {
    console.error("[integration-job] malformed claim identity", { bookingId, jobType });
    return null;
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
      bookingId,
      jobType,
      errorCode: "invalid_claim_envelope",
    });
    return null;
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
      bookingId,
      jobType,
      errorCode: "invalid_provider_payload",
    });
    return null;
  }

  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    payload,
    dependencyResult: row.dependency_result ?? null,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseToken: row.lease_token,
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
      jobId: claim.id,
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
  bookingId,
  jobType,
  errorCode,
}: {
  organizationId: string;
  jobId: string;
  leaseToken: string;
  bookingId: string;
  jobType: IntegrationJobType;
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
    bookingId,
    jobType,
    errorCode,
    settled: data === true && !error,
  });
}
