import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";

import type { AutoHDRBooking, AutoHDRJob, AutoHDRJobStore } from "./application-core";
import {
  AUTOHDR_DATABASE_CONTRACT,
  type AutoHDRCanonicalSource,
  type AutoHDRSourceManifestEntry,
} from "./database-contract";
import { buildQuarantineSourcePutInput } from "./source-upload-core";
import { AUTOHDR_SOURCE_MAX_FILES } from "./source-limits";
import type { AutoHDRJobState } from "./workflow-core";

type DatabaseError = { code?: string; message?: string } | null;
type DatabaseResult = PromiseLike<{ data: unknown; error: DatabaseError }>;
type Query = {
  select(columns: string, options?: { head?: boolean; count?: "exact" }): Query;
  eq(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
  maybeSingle(): DatabaseResult;
  then: DatabaseResult["then"];
};
type DatabaseClient = {
  rpc(name: string, args: Record<string, unknown>): DatabaseResult;
  from(table: string): Query;
};

const JOB_STATES = new Set<AutoHDRJobState>([
  "claimed", "preparing", "awaiting_upload", "finalizing", "processing", "ready",
  "retrieving", "review_pending", "retryable", "reconciliation_required", "rejected",
]);
const PROVIDER_STATUSES = new Set(["created", "uploading", "processing", "ready", "failed", "unknown"]);
const JOB_COLUMNS = [
  "id", "organization_id", "booking_id", "property_id", "state", "provider_uid",
  "provider_status", "provider_uid_assigned_at", "upload_started_at", "finalize_started_at",
  "reconciliation_required_at", "reconciliation_source_state", "last_error_code",
  "last_error_evidence", "last_error_at", "abandoned_at", "abandoned_by",
  "abandon_reason", "retrieval_claim_token", "created_at", "updated_at",
].join(", ");

/** The only application coupling to the separately-owned database RPC contracts. */
export function createAutoHDRJobStore(
  source: unknown = getServiceSupabase(),
): AutoHDRJobStore & {
  listJobs(organizationId: string, bookingId: string): Promise<AutoHDRJob[]>;
  probeSchema(organizationId: string): Promise<boolean>;
} {
  const client = source as DatabaseClient;
  return Object.freeze({
    async loadBooking(bookingId, organizationId) {
      const { data, error } = await client
        .from("bookings")
        .select("id, organization_id, property_id, properties(street_address, city)")
        .eq("id", bookingId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw databaseUnavailable();
      return data ? parseBooking(data) : null;
    },

    async prepareSourceUpload(input) {
      const data = await call(
        client,
        AUTOHDR_DATABASE_CONTRACT.rpc.prepareSourceUpload,
        AUTOHDR_DATABASE_CONTRACT.args.prepareSourceUpload(input),
      );
      return parseCanonicalSources(data, input.organizationId, input.files);
    },

    async acceptSourceUpload(input) {
      const data = await call(
        client,
        AUTOHDR_DATABASE_CONTRACT.rpc.acceptSourceUpload,
        AUTOHDR_DATABASE_CONTRACT.args.acceptSourceUpload({ ...input.file, ...input }),
      );
      parseSourceAcceptance(data, input.file);
      return Object.freeze({
        ...input.file,
        ingestState: "accepted" as const,
        quarantineEtag: input.quarantineEtag,
      });
    },

    async claim(input) {
      const data = await call(client, AUTOHDR_DATABASE_CONTRACT.rpc.claim, AUTOHDR_DATABASE_CONTRACT.args.claim(input));
      const row = unwrapRow(data);
      if (typeof row.newly_created !== "boolean") {
        throw new Error("AutoHDR claim RPC must return the explicit newly_created marker.");
      }
      return { job: parseJob(row), newlyCreated: row.newly_created };
    },

    async loadJob(input) {
      const { data, error } = await client
        .from(AUTOHDR_DATABASE_CONTRACT.jobsTable)
        .select(JOB_COLUMNS)
        .eq("id", input.jobId)
        .eq("booking_id", input.bookingId)
        .eq("property_id", input.propertyId)
        .eq("organization_id", input.organizationId)
        .maybeSingle();
      if (error) throw databaseUnavailable();
      return data ? parseJob(data) : null;
    },

    async transition(input) {
      const data = await call(client, AUTOHDR_DATABASE_CONTRACT.rpc.transition, AUTOHDR_DATABASE_CONTRACT.args.transition(input));
      return parseJob(unwrapRow(data));
    },

    async activateProviderJob(input) {
      const data = await call(
        client,
        AUTOHDR_DATABASE_CONTRACT.rpc.activateProviderJob,
        AUTOHDR_DATABASE_CONTRACT.args.activateProviderJob(input),
      );
      return parseJob(unwrapRow(data));
    },

    async reconcileProviderJob(input) {
      const data = await call(
        client,
        AUTOHDR_DATABASE_CONTRACT.rpc.reconcileProviderJob,
        AUTOHDR_DATABASE_CONTRACT.args.reconcileProviderJob(input),
      );
      return parseJob(unwrapRow(data));
    },

    async abandonProviderJob(input) {
      const data = await call(
        client,
        AUTOHDR_DATABASE_CONTRACT.rpc.abandonProviderJob,
        AUTOHDR_DATABASE_CONTRACT.args.abandonProviderJob(input),
      );
      return parseJob(unwrapRow(data));
    },

    async claimRetrieval(input) {
      const data = await call(
        client,
        AUTOHDR_DATABASE_CONTRACT.rpc.claimRetrieval,
        AUTOHDR_DATABASE_CONTRACT.args.claimRetrieval(input),
      );
      return parseJob(unwrapRow(data));
    },

    async listJobs(organizationId, bookingId) {
      const data = await call(client, AUTOHDR_DATABASE_CONTRACT.rpc.list, {
        p_organization_id: organizationId,
        p_booking_id: bookingId,
      });
      return Array.isArray(data) ? data.map(parseJob) : [];
    },

    async probeSchema(organizationId) {
      const [canonical, jobs] = await Promise.all([
        client.from("media_batches").select("id", { head: true, count: "exact" }).eq("organization_id", organizationId).limit(1),
        client.from(AUTOHDR_DATABASE_CONTRACT.jobsTable).select("id", { head: true, count: "exact" }).eq("organization_id", organizationId).limit(1),
      ]);
      return !canonical.error && !jobs.error;
    },
  });
}

async function call(client: DatabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error || data === null || data === undefined) throw databaseUnavailable();
  return data;
}

function unwrapRow(value: unknown): Record<string, unknown> {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("AutoHDR database contract returned an invalid row.");
  }
  return row as Record<string, unknown>;
}

function parseBooking(value: unknown): AutoHDRBooking {
  const row = unwrapRow(value);
  const propertyValue = Array.isArray(row.properties) ? row.properties[0] : row.properties;
  const property = propertyValue && typeof propertyValue === "object"
    ? propertyValue as Record<string, unknown>
    : {};
  const street = safeText(property.street_address, 500);
  const city = nullableText(property.city, 200);
  return Object.freeze({
    id: uuid(row.id),
    organizationId: uuid(row.organization_id),
    propertyId: uuid(row.property_id),
    address: city ? `${street}, ${city}` : street,
  });
}

function parseJob(value: unknown): AutoHDRJob {
  const row = unwrapRow(value);
  const state = safeText(row.state, 64) as AutoHDRJobState;
  if (!JOB_STATES.has(state)) throw new Error("AutoHDR database returned an unknown job state.");
  return Object.freeze({
    id: uuid(row.id),
    organizationId: uuid(row.organization_id),
    bookingId: uuid(row.booking_id),
    propertyId: uuid(row.property_id),
    state,
    providerUid: nullableText(row.provider_uid, 255),
    providerStatus: nullableProviderStatus(row.provider_status),
    providerUidAssignedAt: nullableText(row.provider_uid_assigned_at, 64),
    uploadStartedAt: nullableText(row.upload_started_at, 64),
    finalizeStartedAt: nullableText(row.finalize_started_at, 64),
    reconciliationRequiredAt: nullableText(row.reconciliation_required_at, 64),
    reconciliationSourceState: nullableReconciliationState(row.reconciliation_source_state),
    lastErrorCode: nullableText(row.last_error_code, 96),
    lastErrorEvidence: nullableText(row.last_error_evidence, 500),
    lastErrorAt: nullableText(row.last_error_at, 64),
    abandonedAt: nullableText(row.abandoned_at, 64),
    abandonedBy: row.abandoned_by == null ? null : uuid(row.abandoned_by),
    abandonReason: nullableText(row.abandon_reason, 500),
    retrievalClaimToken: row.retrieval_claim_token == null ? null : uuid(row.retrieval_claim_token),
    ...(row.created_at ? { createdAt: safeText(row.created_at, 64) } : {}),
    ...(row.updated_at ? { updatedAt: safeText(row.updated_at, 64) } : {}),
  });
}

function parseCanonicalSources(
  value: unknown,
  organizationId: string,
  files: AutoHDRSourceManifestEntry[],
): { sources: AutoHDRCanonicalSource[]; newlyCreated: boolean } {
  if (
    !Array.isArray(value) ||
    value.length !== files.length ||
    value.length < 1 ||
    value.length > AUTOHDR_SOURCE_MAX_FILES
  ) {
    throw new Error("AutoHDR source database contract returned an invalid manifest.");
  }
  let newlyCreated: boolean | null = null;
  const sources = value.map((entry, index) => {
    const row = unwrapRow(entry);
    const expected = files[index];
    if (row.position !== index) throw new Error("AutoHDR source positions are invalid.");
    if (typeof row.newly_created !== "boolean") {
      throw new Error("AutoHDR source creation RPC omitted its explicit newly_created marker.");
    }
    if (newlyCreated !== null && newlyCreated !== row.newly_created) {
      throw new Error("AutoHDR source creation markers are inconsistent.");
    }
    newlyCreated = row.newly_created;
    const source = Object.freeze({
      position: index,
      filename: safeText(row.filename, 255),
      byteSize: positiveInteger(row.byte_size),
      lastModified: expected.lastModified,
      contentType: exactContentType(row.mime_type),
      sha256: byteaHex(row.sha256),
      mediaBatchId: uuid(row.batch_id),
      mediaAssetId: uuid(row.asset_id),
      sourceMediaVersionId: uuid(row.version_id),
      ingestJobId: uuid(row.ingest_job_id),
      quarantineObjectKey: safeText(row.quarantine_object_key, 1024),
      objectKey: safeText(row.object_key, 1024),
      ingestState: exactIngestState(row.ingest_state),
      quarantineEtag: nullableEtag(row.quarantine_etag),
    });
    if (
      source.filename !== expected.filename ||
      source.byteSize !== expected.byteSize ||
      source.contentType !== expected.contentType ||
      source.sha256 !== expected.sha256 ||
      row.bucket_name !== "pixel-blaster-private-media"
    ) {
      throw new Error("AutoHDR source database contract did not echo the exact manifest.");
    }
    buildQuarantineSourcePutInput({
      organizationId,
      ingestJobId: source.ingestJobId,
      quarantineObjectKey: source.quarantineObjectKey,
      mediaAssetId: source.mediaAssetId,
      sourceMediaVersionId: source.sourceMediaVersionId,
      objectKey: source.objectKey,
      byteSize: source.byteSize,
      contentType: source.contentType,
      sha256: source.sha256,
      bucket: "pixel-blaster-private-media",
    });
    return source;
  });
  return { sources, newlyCreated: newlyCreated === true };
}

function parseSourceAcceptance(value: unknown, source: AutoHDRCanonicalSource): void {
  const row = unwrapRow(value);
  if (
    uuid(row.version_id) !== source.sourceMediaVersionId ||
    uuid(row.ingest_job_id) !== source.ingestJobId ||
    row.ingest_state !== "accepted" ||
    row.ingest_job_state !== "accepted" ||
    !safeText(row.accepted_at, 64) ||
    !safeText(row.ingest_completed_at, 64)
  ) {
    throw new Error("AutoHDR source acceptance RPC returned an invalid result.");
  }
}

function uuid(value: unknown): string {
  const text = safeText(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)) {
    throw new Error("AutoHDR database returned an invalid identity.");
  }
  return text;
}

function safeText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("AutoHDR database returned invalid text.");
  }
  return value;
}

function nullableText(value: unknown, max: number): string | null {
  return value == null ? null : safeText(value, max);
}

function nullableProviderStatus(value: unknown): AutoHDRJob["providerStatus"] {
  if (value == null) return null;
  const text = safeText(value, 16);
  if (!PROVIDER_STATUSES.has(text)) throw new Error("AutoHDR database returned an invalid provider status.");
  return text as NonNullable<AutoHDRJob["providerStatus"]>;
}

function nullableReconciliationState(value: unknown): AutoHDRJob["reconciliationSourceState"] {
  if (value == null) return null;
  if (value !== "preparing" && value !== "awaiting_upload" && value !== "finalizing") {
    throw new Error("AutoHDR database returned an invalid reconciliation phase.");
  }
  return value;
}

function byteaHex(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const hex = text.startsWith("\\x") ? text.slice(2) : text;
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("AutoHDR database returned an invalid checksum.");
  return hex;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("AutoHDR database returned an invalid byte size.");
  }
  return value;
}

function exactContentType(value: unknown): "image/jpeg" | "image/png" {
  if (value !== "image/jpeg" && value !== "image/png") {
    throw new Error("AutoHDR database returned an invalid content type.");
  }
  return value;
}

function exactIngestState(value: unknown): "discovered" | "accepted" {
  if (value !== "discovered" && value !== "accepted") {
    throw new Error("AutoHDR database returned an invalid source ingest state.");
  }
  return value;
}

function nullableEtag(value: unknown): string | null {
  if (value == null) return null;
  const text = safeText(value, 130);
  if (!/^(?:W\/)?"[^"\r\n]{1,126}"$/.test(text)) {
    throw new Error("AutoHDR database returned an invalid quarantine ETag.");
  }
  return text;
}

function databaseUnavailable(): Error {
  return new Error("AutoHDR state is temporarily unavailable.");
}
