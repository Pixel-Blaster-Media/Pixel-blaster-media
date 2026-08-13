import type { AdminContext } from "../../auth/require-admin.ts";
import type { AutoHDRNormalizedStatus, AutoHDRStyleInput } from "./contract.ts";
import type {
  AutoHDRCanonicalSource,
  AutoHDRClaimFile,
  AutoHDRSourceManifestEntry,
} from "./database-contract.ts";
import { AUTOHDR_RETRIEVAL_PREREQUISITE } from "./retrieval-prerequisite.ts";
import { pairAutoHDRUploadDestinations } from "./upload-contract.ts";
import {
  buildAutoHDRIdempotencyKey,
  normalizeAutoHDRStyle,
  buildAutoHDRManifestSha256,
  normalizeAcceptedAutoHDRSources,
  type AutoHDRJobState,
} from "./workflow-core.ts";

export type AutoHDRBooking = Readonly<{
  id: string;
  organizationId: string;
  propertyId: string;
  address: string;
}>;

export type AutoHDRJob = Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  propertyId: string;
  state: AutoHDRJobState;
  providerUid: string | null;
  providerStatus?: AutoHDRNormalizedStatus | null;
  providerUidAssignedAt?: string | null;
  uploadStartedAt?: string | null;
  finalizeStartedAt?: string | null;
  reconciliationRequiredAt?: string | null;
  reconciliationSourceState?: "preparing" | "awaiting_upload" | "finalizing" | null;
  lastErrorCode?: string | null;
  lastErrorEvidence?: string | null;
  lastErrorAt?: string | null;
  abandonedAt?: string | null;
  abandonedBy?: string | null;
  abandonReason?: string | null;
  retrievalClaimToken?: string | null;
  createdAt?: string;
  updatedAt?: string;
}>;

type AutoHDRClient = {
  createPhotoshoot(input: {
    files: string[];
    uploadCallbackUrl: string;
    statusCallbackUrl?: string;
    address?: string;
    style?: AutoHDRStyleInput;
  }): Promise<{
    uid: string;
    uploadedFiles: string[];
  }>;
  finalizePhotoshoot(uid: string): Promise<unknown>;
  getStatus(uid: string): Promise<{
    normalizedStatus: "created" | "uploading" | "processing" | "ready" | "failed" | "unknown";
  }>;
};

export type AutoHDRJobStore = {
  loadBooking(bookingId: string, organizationId: string): Promise<AutoHDRBooking | null>;
  prepareSourceUpload(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    requestId: string;
    createdBy: string;
    files: AutoHDRSourceManifestEntry[];
  }): Promise<{ sources: AutoHDRCanonicalSource[]; newlyCreated: boolean }>;
  acceptSourceUpload(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    file: AutoHDRCanonicalSource;
    quarantineEtag: string;
    verifiedWidthPx: number;
    verifiedHeightPx: number;
  }): Promise<AutoHDRCanonicalSource>;
  claim(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    idempotencyKey: string;
    manifestSha256: string;
    files: AutoHDRClaimFile[];
  }): Promise<{ job: AutoHDRJob; newlyCreated: boolean }>;
  loadJob(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    jobId: string;
  }): Promise<AutoHDRJob | null>;
  transition(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    jobId: string;
    expectedState: AutoHDRJobState;
    newState: AutoHDRJobState;
    providerStatus?: AutoHDRNormalizedStatus | null;
    errorCode?: string;
    retrievalClaimToken?: string | null;
  }): Promise<AutoHDRJob>;
  activateProviderJob(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    jobId: string;
    providerUid: string;
  }): Promise<AutoHDRJob>;
  reconcileProviderJob(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    jobId: string;
    expectedState: "preparing" | "awaiting_upload" | "finalizing";
    errorCode: string;
    errorEvidence: string;
    providerUid?: string | null;
  }): Promise<AutoHDRJob>;
  abandonProviderJob(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    jobId: string;
    adminUserId: string;
    reason: string;
  }): Promise<AutoHDRJob>;
  claimRetrieval(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    jobId: string;
  }): Promise<AutoHDRJob>;
};

export class AutoHDRWorkflowError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createAutoHDRApplication(dependencies: {
  store: AutoHDRJobStore;
  requireEnabled(organizationId: string): Promise<unknown>;
  getClient(organizationId: string): Promise<AutoHDRClient>;
  getCallbackUrls(booking: AutoHDRBooking): {
    uploadCallbackUrl: string;
    statusCallbackUrl?: string;
  };
}) {
  const { store } = dependencies;

  async function prepare(input: {
    admin: AdminContext;
    bookingId: string;
    manifest: unknown;
    style: unknown;
  }) {
    const manifest = normalizeAcceptedAutoHDRSources(input.manifest);
    const style = normalizeAutoHDRStyle(input.style);
    const booking = await requireBooking(store, input.bookingId, input.admin.organizationId);
    await dependencies.requireEnabled(input.admin.organizationId);
    const idempotencyKey = buildAutoHDRIdempotencyKey({
      organizationId: input.admin.organizationId,
      bookingId: booking.id,
      manifest,
      style,
    });
    const claimed = await store.claim({
      organizationId: input.admin.organizationId,
      bookingId: booking.id,
      propertyId: booking.propertyId,
      idempotencyKey,
      manifestSha256: buildAutoHDRManifestSha256(manifest),
      files: manifest.map((file) => ({
        position: file.position,
        sourceMediaVersionId: file.sourceMediaVersionId,
        filename: file.filename,
      })),
    });
    if (!claimed.newlyCreated || claimed.job.state !== "claimed") {
      throw new AutoHDRWorkflowError(
        "idempotency_conflict",
        "This exact AutoHDR job was already claimed. Signed upload destinations are only returned once; reconcile or start a deliberately different job.",
        409,
      );
    }
    const preparing = await store.transition(identity(claimed.job, "claimed", "preparing"));

    let providerCreated = false;
    let providerUid: string | null = null;
    let reconciliationState: "preparing" | "awaiting_upload" = "preparing";
    try {
      const client = await dependencies.getClient(input.admin.organizationId);
      const callbacks = dependencies.getCallbackUrls(booking);
      const created = await client.createPhotoshoot({
        files: manifest.map((file) => file.filename),
        address: booking.address,
        style,
        ...callbacks,
      });
      providerCreated = true;
      providerUid = created.uid;
      const job = await store.activateProviderJob({
        organizationId: input.admin.organizationId,
        bookingId: booking.id,
        propertyId: booking.propertyId,
        jobId: claimed.job.id,
        providerUid: created.uid,
      });
      reconciliationState = "awaiting_upload";
      const uploads = pairAutoHDRUploadDestinations(
        manifest.map((file) => file.filename),
        created.uploadedFiles,
      );
      return { ok: true as const, job, uploads };
    } catch {
      await reconcileOrThrow(store, preparing, reconciliationState, {
        errorCode: "provider_outcome_ambiguous",
        errorEvidence: providerCreated
          ? "Provider creation returned, but local upload phase activation was not confirmed."
          : "Provider creation outcome was not confirmed.",
        providerUid,
      });
      throw new AutoHDRWorkflowError(
        "provider_outcome_ambiguous",
        providerCreated
          ? "AutoHDR created remote work, but local confirmation failed. Reconciliation is required and this job will not be retried automatically."
          : "The AutoHDR creation outcome is uncertain. Reconciliation is required and this job will not be retried automatically.",
        502,
      );
    }
  }

  async function finalize(input: {
    admin: AdminContext;
    bookingId: string;
    jobId: string;
  }) {
    const { booking, job } = await requireBookingAndJob(store, input);
    requireState(job, "awaiting_upload");
    if (!job.providerUid) throw new AutoHDRWorkflowError("job_invalid", "AutoHDR job is missing its provider identity.", 409);
    await dependencies.requireEnabled(input.admin.organizationId);
    const client = await dependencies.getClient(input.admin.organizationId);
    const finalizing = await store.transition({
      ...identity(job, "awaiting_upload", "finalizing"), providerStatus: "uploading",
    });
    try {
      await client.finalizePhotoshoot(job.providerUid);
      const updated = await store.transition({
        ...identity(finalizing, "finalizing", "processing"), providerStatus: "processing",
      });
      return { ok: true as const, job: updated };
    } catch {
      await reconcileOrThrow(store, finalizing, "finalizing", {
        errorCode: "provider_outcome_ambiguous",
        errorEvidence: "Provider finalize outcome or local processing confirmation was not authoritative.",
      });
      throw new AutoHDRWorkflowError(
        "provider_outcome_ambiguous",
        "The AutoHDR finalize outcome is uncertain. Reconciliation is required and finalize will not be retried automatically.",
        502,
      );
    }
  }

  async function refresh(input: {
    admin: AdminContext;
    bookingId: string;
    jobId: string;
  }) {
    const { job } = await requireBookingAndJob(store, input);
    requireState(job, "processing");
    if (!job.providerUid) throw new AutoHDRWorkflowError("job_invalid", "AutoHDR job is missing its provider identity.", 409);
    await dependencies.requireEnabled(input.admin.organizationId);
    const client = await dependencies.getClient(input.admin.organizationId);
    let status: Awaited<ReturnType<AutoHDRClient["getStatus"]>>;
    try {
      status = await client.getStatus(job.providerUid);
    } catch {
      throw new AutoHDRWorkflowError("provider_unavailable", "AutoHDR status is temporarily unavailable.", 502);
    }
    if (status.normalizedStatus === "ready") {
      return { ok: true as const, job: await store.transition({
        ...identity(job, "processing", "ready"), providerStatus: "ready",
      }) };
    }
    if (status.normalizedStatus === "failed") {
      return {
        ok: true as const,
        job: await store.transition({
          ...identity(job, "processing", "rejected"), providerStatus: "failed", errorCode: "provider_failed",
        }),
      };
    }
    if (status.normalizedStatus === "unknown") {
      return {
        ok: true as const,
        job: await store.transition({
          ...identity(job, "processing", "reconciliation_required"),
          providerStatus: "unknown",
          errorCode: "unknown_provider_status",
        }),
      };
    }
    if (status.normalizedStatus === "created" || status.normalizedStatus === "uploading") {
      return {
        ok: true as const,
        job: await store.transition({
          ...identity(job, "processing", "reconciliation_required"),
          providerStatus: status.normalizedStatus,
          errorCode: "provider_phase_regression",
        }),
      };
    }
    return { ok: true as const, job };
  }

  async function reconcile(input: { admin: AdminContext; bookingId: string; jobId: string }) {
    const { job } = await requireBookingAndJob(store, input);
    if (job.state !== "preparing" && job.state !== "awaiting_upload" && job.state !== "finalizing") {
      throw new AutoHDRWorkflowError("invalid_job_state", "This AutoHDR job is not stranded in a reconcilable phase.", 409);
    }
    return { ok: true as const, job: await store.reconcileProviderJob({
      organizationId: job.organizationId,
      bookingId: job.bookingId,
      propertyId: job.propertyId,
      jobId: job.id,
      expectedState: job.state,
      errorCode: "operator_reconciliation_requested",
      errorEvidence: "An operator requested reconciliation after browser capabilities were unavailable.",
    }) };
  }

  async function abandon(input: {
    admin: AdminContext; bookingId: string; jobId: string; reason: string;
  }) {
    const { job } = await requireBookingAndJob(store, input);
    const reason = boundedOperatorReason(input.reason);
    return { ok: true as const, job: await store.abandonProviderJob({
      organizationId: job.organizationId,
      bookingId: job.bookingId,
      propertyId: job.propertyId,
      jobId: job.id,
      adminUserId: input.admin.userId,
      reason,
    }) };
  }

  async function retrieve(input: {
    admin: AdminContext;
    bookingId: string;
    jobId: string;
  }) {
    const { job } = await requireBookingAndJob(store, input);
    requireState(job, "ready");
    await dependencies.requireEnabled(input.admin.organizationId);
    return {
      ok: false as const,
      code: "secure_ingestion_prerequisite" as const,
      error: AUTOHDR_RETRIEVAL_PREREQUISITE,
    };
  }

  return Object.freeze({ prepare, finalize, refresh, reconcile, abandon, retrieve });
}

async function requireBooking(
  store: AutoHDRJobStore,
  bookingId: string,
  organizationId: string,
): Promise<AutoHDRBooking> {
  const booking = await store.loadBooking(bookingId, organizationId);
  if (!booking || booking.organizationId !== organizationId || booking.id !== bookingId) {
    throw new AutoHDRWorkflowError("booking_not_found", "Booking not found.", 404);
  }
  return booking;
}

async function requireBookingAndJob(
  store: AutoHDRJobStore,
  input: { admin: AdminContext; bookingId: string; jobId: string },
): Promise<{ booking: AutoHDRBooking; job: AutoHDRJob }> {
  const booking = await requireBooking(store, input.bookingId, input.admin.organizationId);
  const job = await store.loadJob({
    organizationId: input.admin.organizationId,
    bookingId: booking.id,
    propertyId: booking.propertyId,
    jobId: input.jobId,
  });
  if (
    !job || job.organizationId !== input.admin.organizationId ||
    job.bookingId !== booking.id || job.propertyId !== booking.propertyId
  ) {
    throw new AutoHDRWorkflowError("job_not_found", "AutoHDR job not found.", 404);
  }
  return { booking, job };
}

function requireState(job: AutoHDRJob, expected: AutoHDRJobState): void {
  if (job.state !== expected) {
    throw new AutoHDRWorkflowError(
      "invalid_job_state",
      `AutoHDR job is not in the required ${expected} state.`,
      409,
    );
  }
}

function identity(job: AutoHDRJob, from: AutoHDRJobState, to: AutoHDRJobState) {
  return {
    organizationId: job.organizationId,
    bookingId: job.bookingId,
    propertyId: job.propertyId,
    jobId: job.id,
    expectedState: from,
    newState: to,
  };
}

async function reconcileOrThrow(
  store: AutoHDRJobStore,
  job: AutoHDRJob,
  from: "preparing" | "awaiting_upload" | "finalizing",
  evidence: { errorCode: string; errorEvidence: string; providerUid?: string | null },
): Promise<void> {
  try {
    await store.reconcileProviderJob({
      organizationId: job.organizationId,
      bookingId: job.bookingId,
      propertyId: job.propertyId,
      jobId: job.id,
      expectedState: from,
      ...evidence,
    });
  } catch {
    throw new AutoHDRWorkflowError(
      "reconciliation_persistence_failed",
      "AutoHDR reconciliation could not be durably recorded. Stop and escalate this job before any retry.",
      503,
    );
  }
}

function boundedOperatorReason(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AutoHDRWorkflowError("invalid_request", "An operator reason between 1 and 500 characters is required.");
  }
  return value;
}
