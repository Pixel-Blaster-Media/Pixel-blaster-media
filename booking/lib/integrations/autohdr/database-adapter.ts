import "server-only";

import { getServiceSupabase } from "@/lib/supabase/server";

import type {
  AutoHDRBooking,
  AutoHDRJob,
  AutoHDRJobStore,
} from "./application-core";
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
  "claimed",
  "preparing",
  "awaiting_upload",
  "finalizing",
  "processing",
  "ready",
  "retrieving",
  "review_pending",
  "retryable",
  "reconciliation_required",
  "rejected",
]);

/**
 * This is the only coupling to the separately-owned state-machine migration.
 * RPC names, table name, argument names, and result decoding can be adjusted
 * here without changing route or workflow code.
 */
export const AUTOHDR_DATABASE_CONTRACT = Object.freeze({
  jobsTable: "autohdr_jobs",
  rpc: Object.freeze({
    claim: "claim_autohdr_job",
    transition: "transition_autohdr_job",
    assignProviderUid: "assign_autohdr_provider_uid",
    claimRetrieval: "claim_autohdr_retrieval",
  }),
  args: Object.freeze({
    claim(input: Parameters<AutoHDRJobStore["claim"]>[0]) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_idempotency_key: input.idempotencyKey,
        p_file_manifest: input.manifest,
        p_style: input.style,
        p_created_by: input.createdBy,
      };
    },
    transition(input: Parameters<AutoHDRJobStore["transition"]>[0]) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_job_id: input.jobId,
        p_from_state: input.from,
        p_to_state: input.to,
        p_error_code: input.errorCode ?? null,
      };
    },
    assignProviderUid(input: Parameters<AutoHDRJobStore["assignProviderUid"]>[0]) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_job_id: input.jobId,
        p_provider_uid: input.providerUid,
      };
    },
    claimRetrieval(input: Parameters<AutoHDRJobStore["claimRetrieval"]>[0]) {
      return {
        p_organization_id: input.organizationId,
        p_booking_id: input.bookingId,
        p_job_id: input.jobId,
        p_claimed_by: input.claimedBy,
      };
    },
  }),
});

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
      if (!data) return null;
      return parseBooking(data);
    },

    async claim(input) {
      const data = await call(
        client,
        AUTOHDR_DATABASE_CONTRACT.rpc.claim,
        AUTOHDR_DATABASE_CONTRACT.args.claim(input),
      );
      const row = unwrapRow(data);
      const marker = row.newly_claimed;
      if (typeof marker !== "boolean") {
        throw new Error("AutoHDR claim RPC must return newly_claimed explicitly.");
      }
      return { job: parseJob(row), newlyClaimed: marker };
    },

    async loadJob(input) {
      const { data, error } = await client
        .from(AUTOHDR_DATABASE_CONTRACT.jobsTable)
        .select("id, organization_id, booking_id, state, provider_uid, created_at, updated_at")
        .eq("id", input.jobId)
        .eq("booking_id", input.bookingId)
        .eq("organization_id", input.organizationId)
        .maybeSingle();
      if (error) throw databaseUnavailable();
      return data ? parseJob(data) : null;
    },

    async transition(input) {
      const data = await call(
        client,
        AUTOHDR_DATABASE_CONTRACT.rpc.transition,
        AUTOHDR_DATABASE_CONTRACT.args.transition(input),
      );
      return parseJob(unwrapRow(data));
    },

    async assignProviderUid(input) {
      const data = await call(
        client,
        AUTOHDR_DATABASE_CONTRACT.rpc.assignProviderUid,
        AUTOHDR_DATABASE_CONTRACT.args.assignProviderUid(input),
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
      const { data, error } = await client
        .from(AUTOHDR_DATABASE_CONTRACT.jobsTable)
        .select("id, organization_id, booking_id, state, provider_uid, created_at, updated_at")
        .eq("organization_id", organizationId)
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw databaseUnavailable();
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

async function call(
  client: DatabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
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
    state,
    providerUid: nullableText(row.provider_uid, 255),
    ...(row.created_at ? { createdAt: safeText(row.created_at, 64) } : {}),
    ...(row.updated_at ? { updatedAt: safeText(row.updated_at, 64) } : {}),
  });
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
  return value === null || value === undefined ? null : safeText(value, max);
}

function databaseUnavailable(): Error {
  return new Error("AutoHDR state is temporarily unavailable.");
}
