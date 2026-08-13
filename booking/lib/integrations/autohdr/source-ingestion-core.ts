import { buildMasterKey, inspectMediaObjectKey, type MediaObjectKey } from "../../media/storage/keys.ts";
import type { AutoHDRCanonicalSource } from "./database-contract.ts";
import { canonicalSourceExtension, validateCanonicalSourceUpload } from "./source-upload-core.ts";

const ETAG = /^(?:W\/)?"[^"\r\n]{1,126}"$/;

type StorageHead = Readonly<{
  bytes: number;
  contentType: string | null;
  sha256: string;
  etag: string | null;
}>;

type SourceStorage = {
  head(key: MediaObjectKey, signal?: AbortSignal): Promise<StorageHead>;
  getVerified(key: MediaObjectKey, signal?: AbortSignal): Promise<{
    body: AsyncIterable<unknown> & { destroy?(error?: Error): void };
    bytes: number;
    contentType: string | null;
    sha256: string;
  }>;
  promoteQuarantineCreateOnly(input: {
    sourceKey: MediaObjectKey;
    destinationKey: MediaObjectKey;
    expectedSourceEtag: string;
    expectedBytes: number;
    contentType: string;
    sha256: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  deleteQuarantine(input: {
    key: MediaObjectKey;
    expectedEtag: string;
    signal?: AbortSignal;
  }): Promise<void>;
};

type SourceStore = {
  acceptSourceUpload(input: {
    organizationId: string;
    bookingId: string;
    propertyId: string;
    file: AutoHDRCanonicalSource;
    quarantineEtag: string;
    verifiedWidthPx: number;
    verifiedHeightPx: number;
  }): Promise<AutoHDRCanonicalSource>;
};

export type AutoHDRSourceIngestionResult = Readonly<{
  position: number;
  sourceMediaVersionId: string;
  status: "accepted" | "reconciliation_required";
  cleanup: "deleted" | "pending" | "not_applicable";
  source?: AutoHDRCanonicalSource;
  code?: string;
}>;

export async function ingestAutoHDRSourceFiles(input: {
  organizationId: string;
  bookingId: string;
  propertyId: string;
  sources: AutoHDRCanonicalSource[];
  storage: SourceStorage;
  store: SourceStore;
  verifyImage(
    body: AsyncIterable<unknown>,
    contentType: "image/jpeg" | "image/png",
    signal?: AbortSignal,
  ): Promise<{ widthPx: number; heightPx: number }>;
  signal: AbortSignal;
  perFileTimeoutMs: number;
  onProgress?: (result: AutoHDRSourceIngestionResult, completed: number, total: number) => void;
}): Promise<{ results: AutoHDRSourceIngestionResult[]; sources: AutoHDRCanonicalSource[] }> {
  const results: AutoHDRSourceIngestionResult[] = [];
  const accepted: AutoHDRCanonicalSource[] = [];

  for (const source of input.sources) {
    input.signal.throwIfAborted();
    const fileSignal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(input.perFileTimeoutMs),
    ]);
    let result: AutoHDRSourceIngestionResult;
    if (source.ingestState === "accepted") {
      exactKeys(input.organizationId, source);
      const cleanup = await cleanupAcceptedSource(
        input.storage,
        source,
        input.organizationId,
        fileSignal,
      );
      result = Object.freeze({
        position: source.position,
        sourceMediaVersionId: source.sourceMediaVersionId,
        status: "accepted" as const,
        cleanup,
        source,
      });
      accepted.push(source);
    } else {
      try {
        const processed = await ingestOne(input, source, fileSignal);
        result = processed;
        if (processed.source) accepted.push(processed.source);
      } catch {
        result = reconciliation(source, fileSignal.aborted ? "source_timeout_or_abort" : "source_verification_failed");
      }
    }
    results.push(result);
    input.onProgress?.(result, results.length, input.sources.length);
  }

  return { results: Object.freeze(results) as AutoHDRSourceIngestionResult[], sources: Object.freeze(accepted) as AutoHDRCanonicalSource[] };
}

async function ingestOne(
  input: Parameters<typeof ingestAutoHDRSourceFiles>[0],
  source: AutoHDRCanonicalSource,
  signal: AbortSignal,
): Promise<AutoHDRSourceIngestionResult> {
  const { quarantineKey, masterKey } = exactKeys(input.organizationId, source);
  const quarantineHead = await input.storage.head(quarantineKey, signal);
  validateObject(source, input.organizationId, quarantineHead);
  if (!quarantineHead.etag || !ETAG.test(quarantineHead.etag)) {
    return reconciliation(source, "quarantine_etag_unusable");
  }
  const quarantineEtag = quarantineHead.etag;
  const quarantineDownload = await input.storage.getVerified(quarantineKey, signal);
  validateObject(source, input.organizationId, { ...quarantineDownload, etag: quarantineEtag });
  const dimensions = await input.verifyImage(quarantineDownload.body, source.contentType, signal);

  const existing = await verifyMaster(input.storage, source, input.organizationId, masterKey, signal);
  if (existing === "mismatch") return reconciliation(source, "master_mismatch");
  if (existing === "missing") {
    try {
      await input.storage.promoteQuarantineCreateOnly({
        sourceKey: quarantineKey,
        destinationKey: masterKey,
        expectedSourceEtag: quarantineEtag,
        expectedBytes: source.byteSize,
        contentType: source.contentType,
        sha256: source.sha256,
        signal,
      });
    } catch {
      // A lost response or create-only precondition may still mean the exact
      // immutable destination exists. Only a full server-side reconciliation
      // may decide that it is safe to continue.
    }
    const promoted = await verifyMaster(input.storage, source, input.organizationId, masterKey, signal);
    if (promoted !== "correct") return reconciliation(source, "promotion_ambiguous");
  }

  const accepted = await input.store.acceptSourceUpload({
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    propertyId: input.propertyId,
    file: source,
    quarantineEtag,
    verifiedWidthPx: dimensions.widthPx,
    verifiedHeightPx: dimensions.heightPx,
  });
  let cleanup: AutoHDRSourceIngestionResult["cleanup"] = "deleted";
  try {
    await input.storage.deleteQuarantine({ key: quarantineKey, expectedEtag: quarantineEtag, signal });
  } catch {
    cleanup = "pending";
  }
  return Object.freeze({
    position: source.position,
    sourceMediaVersionId: source.sourceMediaVersionId,
    status: "accepted" as const,
    cleanup,
    source: accepted,
  });
}

function exactKeys(organizationId: string, source: AutoHDRCanonicalSource): {
  quarantineKey: MediaObjectKey;
  masterKey: MediaObjectKey;
} {
  const quarantine = inspectMediaObjectKey(source.quarantineObjectKey, organizationId);
  if (
    quarantine.objectClass !== "quarantine" ||
    !source.quarantineObjectKey.startsWith(`quarantine/${organizationId}/${source.ingestJobId}/`)
  ) {
    throw new Error("AutoHDR quarantine key does not match its exact tenant and ingest identity.");
  }
  const expectedMaster = buildMasterKey(
    organizationId,
    source.mediaAssetId,
    source.sourceMediaVersionId,
    source.sha256,
    canonicalSourceExtension(source.contentType),
  );
  if (source.objectKey !== expectedMaster) {
    throw new Error("AutoHDR master key does not match its exact canonical identity.");
  }
  return { quarantineKey: quarantine.key, masterKey: expectedMaster };
}

function validateObject(
  source: AutoHDRCanonicalSource,
  organizationId: string,
  head: StorageHead,
): void {
  validateCanonicalSourceUpload({ ...source, organizationId }, head);
}

async function verifyMaster(
  storage: SourceStorage,
  source: AutoHDRCanonicalSource,
  organizationId: string,
  key: MediaObjectKey,
  signal: AbortSignal,
): Promise<"missing" | "correct" | "mismatch"> {
  try {
    const head = await storage.head(key, signal);
    validateObject(source, organizationId, head);
    const download = await storage.getVerified(key, signal);
    validateObject(source, organizationId, { ...download, etag: head.etag });
    for await (const _chunk of download.body) signal.throwIfAborted();
    return "correct";
  } catch (error) {
    return missingObject(error) ? "missing" : "mismatch";
  }
}

async function cleanupAcceptedSource(
  storage: SourceStorage,
  source: AutoHDRCanonicalSource,
  organizationId: string,
  signal: AbortSignal,
): Promise<AutoHDRSourceIngestionResult["cleanup"]> {
  if (!source.quarantineEtag || !ETAG.test(source.quarantineEtag)) return "pending";
  try {
    const parsed = inspectMediaObjectKey(source.quarantineObjectKey, organizationId);
    if (parsed.objectClass !== "quarantine") return "pending";
    await storage.deleteQuarantine({ key: parsed.key, expectedEtag: source.quarantineEtag, signal });
    return "deleted";
  } catch (error) {
    return missingObject(error) ? "deleted" : "pending";
  }
}

function reconciliation(source: AutoHDRCanonicalSource, code: string): AutoHDRSourceIngestionResult {
  return Object.freeze({
    position: source.position,
    sourceMediaVersionId: source.sourceMediaVersionId,
    status: "reconciliation_required" as const,
    cleanup: "not_applicable" as const,
    code,
  });
}

function missingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "NotFound" || candidate.name === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404;
}
