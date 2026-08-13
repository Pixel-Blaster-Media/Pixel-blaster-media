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
  assignProviderUid(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    jobId: string;
    providerUid: string;
    providerStatus: AutoHDRNormalizedStatus;
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
    await store.transition(identity(claimed.job, "claimed", "preparing"));

    let providerCreated = false;
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
      const uploads = pairAutoHDRUploadDestinations(
        manifest.map((file) => file.filename),
        created.uploadedFiles,
      );
      await store.assignProviderUid({
        organizationId: input.admin.organizationId,
        bookingId: booking.id,
        propertyId: booking.propertyId,
        jobId: claimed.job.id,
        providerUid: created.uid,
        providerStatus: "created",
      });
      const job = await store.transition({
        ...identity(claimed.job, "preparing", "awaiting_upload"),
        providerStatus: "uploading",
      });
      return { ok: true as const, job, uploads };
    } catch {
      await reconcileQuietly(store, claimed.job, "preparing", "provider_outcome_ambiguous");
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
    await store.transition({ ...identity(job, "awaiting_upload", "finalizing"), providerStatus: "uploading" });
    try {
      await client.finalizePhotoshoot(job.providerUid);
      const updated = await store.transition({ ...identity(job, "finalizing", "processing"), providerStatus: "processing" });
      return { ok: true as const, job: updated };
    } catch {
      await reconcileQuietly(store, job, "finalizing", "provider_outcome_ambiguous");
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
    return { ok: true as const, job };
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

  return Object.freeze({ prepare, finalize, refresh, retrieve });
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

async function reconcileQuietly(
  store: AutoHDRJobStore,
  job: AutoHDRJob,
  from: AutoHDRJobState,
  errorCode: string,
): Promise<void> {
  await store.transition({
    ...identity(job, from, "reconciliation_required"),
    errorCode,
  }).catch(() => undefined);
}
