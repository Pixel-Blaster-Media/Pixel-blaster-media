import { inspectMediaObjectKey, type MediaObjectKey } from "../../media/storage/keys.ts";
import { validateCanonicalSourceUpload } from "./source-upload-core.ts";

const ETAG = /^(?:W\/)?"[^"\r\n]{1,126}"$/;

type SourceClaim = Readonly<{
  organizationId: string; bookingId: string; propertyId: string; batchId: string;
  assetId: string; versionId: string; ingestJobId: string; requestId: string;
  position: number; quarantineBucketName: string; quarantineObjectKey: string;
  quarantineEtag: string; masterBucketName: string; masterObjectKey: string;
  sha256: string; byteSize: number; mimeType: "image/jpeg" | "image/png";
  workerId: string; leaseToken: string; leaseExpiresAt: string;
}>;

type MasterReservation = Readonly<{
  versionId: string; assetId: string; batchId: string; bucketName: string;
  objectKey: string; newlyReserved: boolean; reusedAccepted: boolean;
}>;

type SourceStore = {
  claimSourceFile(input: { organizationId: string; workerId: string; leaseSeconds: number }): Promise<SourceClaim | null>;
  reserveSourceMaster(input: SourceClaim): Promise<MasterReservation>;
  completeSourceFile(input: SourceClaim & {
    outcome: "accepted" | "reused_accepted"; master: MasterReservation;
    verifiedWidthPx: number; verifiedHeightPx: number;
  }): Promise<unknown>;
  settleSourceFile(input: SourceClaim & {
    outcome: "retryable" | "reconciliation_required"; errorCode: string;
  }): Promise<unknown>;
};

type SourceStorage = {
  head(key: MediaObjectKey, signal?: AbortSignal): Promise<{ bytes: number; contentType: string | null; sha256: string; etag: string | null }>;
  getVerified(key: MediaObjectKey, signal?: AbortSignal): Promise<{
    body: AsyncIterable<unknown>; bytes: number; contentType: string | null; sha256: string;
  }>;
  promoteQuarantineCreateOnly(input: {
    sourceKey: MediaObjectKey; destinationKey: MediaObjectKey; expectedSourceEtag: string;
    expectedBytes: number; contentType: string; sha256: string; signal?: AbortSignal;
  }): Promise<unknown>;
};

export async function runOneAutoHDRSourceFile(input: {
  organizationId: string; workerId: string; leaseSeconds: number; timeoutMs: number;
  store: SourceStore; storage: SourceStorage;
  verifyImage(body: AsyncIterable<unknown>, contentType: "image/jpeg" | "image/png", signal?: AbortSignal): Promise<{ widthPx: number; heightPx: number }>;
}): Promise<
  | { status: "idle" }
  | { status: "accepted"; ingestJobId: string; reused: boolean }
  | { status: "reconciliation_required"; ingestJobId: string; code: string }
  | { status: "retryable"; ingestJobId: string; code: string }
> {
  const claim = await input.store.claimSourceFile(input);
  if (!claim) return { status: "idle" };
  const signal = AbortSignal.timeout(input.timeoutMs);
  try {
    const quarantine = exactQuarantineKey(claim);
    const master = exactMasterKey(claim);
    const head = await input.storage.head(quarantine, signal);
    validateClaimObject(claim, head);
    if (head.etag !== claim.quarantineEtag || !ETAG.test(claim.quarantineEtag)) {
      throw workerFailure("source_quarantine_etag_drift", false);
    }
    const download = await input.storage.getVerified(quarantine, signal);
    validateClaimObject(claim, { ...download, etag: head.etag });
    const dimensions = await input.verifyImage(download.body, claim.mimeType, signal);
    const reservation = await input.store.reserveSourceMaster(claim);
    if (reservation.newlyReserved) {
      await input.storage.promoteQuarantineCreateOnly({
        sourceKey: quarantine, destinationKey: master,
        expectedSourceEtag: claim.quarantineEtag, expectedBytes: claim.byteSize,
        contentType: claim.mimeType, sha256: claim.sha256, signal,
      });
    } else if (!reservation.reusedAccepted) {
      throw workerFailure("source_master_reservation_pending", true);
    }
    await input.store.completeSourceFile({
      ...claim, outcome: reservation.reusedAccepted ? "reused_accepted" : "accepted",
      master: reservation, verifiedWidthPx: dimensions.widthPx, verifiedHeightPx: dimensions.heightPx,
    });
    return { status: "accepted", ingestJobId: claim.ingestJobId, reused: reservation.reusedAccepted };
  } catch (error) {
    const failure = classifySourceFailure(error, signal);
    await input.store.settleSourceFile({ ...claim, outcome: failure.retryable ? "retryable" : "reconciliation_required", errorCode: failure.code });
    return failure.retryable
      ? { status: "retryable", ingestJobId: claim.ingestJobId, code: failure.code }
      : { status: "reconciliation_required", ingestJobId: claim.ingestJobId, code: failure.code };
  }
}

function exactQuarantineKey(claim: SourceClaim): MediaObjectKey {
  const parsed = inspectMediaObjectKey(claim.quarantineObjectKey, claim.organizationId);
  if (parsed.objectClass !== "quarantine" || !claim.quarantineObjectKey.startsWith(`quarantine/${claim.organizationId}/${claim.ingestJobId}/`)) {
    throw workerFailure("source_quarantine_identity_invalid", false);
  }
  return parsed.key;
}

function exactMasterKey(claim: SourceClaim): MediaObjectKey {
  const parsed = inspectMediaObjectKey(claim.masterObjectKey, claim.organizationId);
  if (parsed.objectClass !== "masters") throw workerFailure("source_master_identity_invalid", false);
  return parsed.key;
}

function validateClaimObject(claim: SourceClaim, object: { bytes: number; contentType: string | null; sha256: string; etag: string | null }): void {
  validateCanonicalSourceUpload({
    organizationId: claim.organizationId, mediaAssetId: claim.assetId,
    sourceMediaVersionId: claim.versionId, objectKey: claim.masterObjectKey,
    byteSize: claim.byteSize, contentType: claim.mimeType, sha256: claim.sha256,
  }, object);
}

function workerFailure(code: string, retryable: boolean): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(code), { code, retryable });
}

function missingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "NotFound" || candidate.name === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404;
}

function classifySourceFailure(error: unknown, signal: AbortSignal): { code: string; retryable: boolean } {
  if (missingObject(error)) return { code: "source_object_not_found", retryable: false };
  if (error && typeof error === "object" && "code" in error && "retryable" in error) {
    return { code: String(error.code), retryable: error.retryable === true };
  }
  if (signal.aborted) return { code: "source_worker_timeout", retryable: true };
  return { code: "source_worker_failed", retryable: true };
}

type CleanupClaim = Readonly<{
  organizationId: string; bookingId: string; propertyId: string; ingestJobId: string;
  quarantineObjectKey: string; quarantineEtag: string | null; cleanupObjectEtag: string | null;
  cleanupAttempts: number; cleanupLeaseToken: string; cleanupLeaseExpiresAt: string;
  lifecycleState: string;
}>;

type CleanupStore = {
  claimQuarantineCleanup(input: { limit: number; leaseSeconds: number }): Promise<CleanupClaim[]>;
  settleQuarantineCleanup(input: CleanupClaim & {
    quarantineEtag: string | null;
    outcome: "cleaned" | "not_found" | "retryable" | "reconciliation_required";
    errorCode: string | null;
  }): Promise<unknown>;
};

export async function runAutoHDRQuarantineCleanup(input: {
  limit: number; leaseSeconds: number; maxAttempts: number; timeoutMs: number;
  store: CleanupStore;
  storageFor(organizationId: string): Pick<SourceStorage, "head"> & { deleteQuarantine(input: { key: MediaObjectKey; expectedEtag: string; signal?: AbortSignal }): Promise<void> };
}): Promise<{ claimed: number; settled: number }> {
  const claims = await input.store.claimQuarantineCleanup(input);
  let settled = 0;
  for (const claim of claims) {
    const signal = AbortSignal.timeout(input.timeoutMs);
    let outcome: "cleaned" | "not_found" | "retryable" | "reconciliation_required";
    let errorCode: string | null = null;
    let observedEtag: string | null = null;
    try {
      const key = exactCleanupKey(claim);
      const storage = input.storageFor(claim.organizationId);
      const head = await storage.head(key, signal);
      observedEtag = head.etag;
      const expected = claim.quarantineEtag ?? claim.cleanupObjectEtag;
      if (!observedEtag || !ETAG.test(observedEtag) || (expected !== null && observedEtag !== expected)) {
        outcome = "reconciliation_required";
        errorCode = "quarantine_cleanup_etag_drift";
      } else {
        await storage.deleteQuarantine({ key, expectedEtag: observedEtag, signal });
        outcome = "cleaned";
      }
    } catch (error) {
      if (missingObject(error)) {
        outcome = "not_found";
        observedEtag = null;
      } else if (claim.cleanupAttempts >= input.maxAttempts) {
        outcome = "reconciliation_required";
        errorCode = "quarantine_cleanup_retry_exhausted";
      } else {
        outcome = "retryable";
        errorCode = signal.aborted ? "quarantine_cleanup_timeout" : "quarantine_cleanup_delete_failed";
      }
    }
    await input.store.settleQuarantineCleanup({ ...claim, quarantineEtag: observedEtag, outcome, errorCode });
    settled += 1;
  }
  return { claimed: claims.length, settled };
}

function exactCleanupKey(claim: CleanupClaim): MediaObjectKey {
  const parsed = inspectMediaObjectKey(claim.quarantineObjectKey, claim.organizationId);
  if (parsed.objectClass !== "quarantine" || !claim.quarantineObjectKey.startsWith(`quarantine/${claim.organizationId}/${claim.ingestJobId}/`)) {
    throw workerFailure("quarantine_cleanup_identity_invalid", false);
  }
  return parsed.key;
}
