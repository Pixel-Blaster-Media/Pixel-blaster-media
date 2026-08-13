import "server-only";

import type { AdminContext } from "@/lib/auth/require-admin";
import { requirePhotoEditingProviderEnabled } from "@/lib/integrations/provider-enablement";
import { createProductionR2Storage } from "@/lib/media/storage/r2";

import { AutoHDRWorkflowError, createAutoHDRApplication } from "./application-core";
import { getAutoHDRClient } from "./client";
import { createAutoHDRJobStore } from "./database-adapter";
import { presignCanonicalAutoHDRSources } from "./source-upload";
import { ingestAutoHDRSourceFiles } from "./source-ingestion-core";
import { verifyCanonicalImageStream } from "./source-image-verification";
import { normalizeAutoHDRSourceManifest } from "./workflow-core";

const SOURCE_FILE_TIMEOUT_MS = 30_000;

function application() {
  return createAutoHDRApplication({
    store: createAutoHDRJobStore(),
    requireEnabled: (organizationId) =>
      requirePhotoEditingProviderEnabled("autohdr", organizationId),
    getClient: getAutoHDRClient,
    getCallbackUrls: () => {
      const raw = process.env.NEXT_PUBLIC_APP_URL;
      let origin: URL;
      try {
        origin = new URL(raw ?? "");
      } catch {
        throw new Error("AutoHDR callback origin is unavailable.");
      }
      if (origin.protocol !== "https:" || origin.username || origin.password) {
        throw new Error("AutoHDR callback origin is unavailable.");
      }
      return {
        uploadCallbackUrl: new URL("/api/integrations/autohdr/upload", origin).toString(),
      };
    },
  });
}

export async function prepareBookingAutoHDR(input: {
  admin: AdminContext;
  bookingId: string;
  manifest: unknown;
  style: unknown;
}) {
  return application().prepare(input);
}

export async function prepareBookingAutoHDRSourceUpload(input: {
  admin: AdminContext;
  bookingId: string;
  manifest: unknown;
  requestId: string;
}) {
  const store = createAutoHDRJobStore();
  const booking = await requireScopedBooking(store, input.bookingId, input.admin.organizationId);
  await requirePhotoEditingProviderEnabled("autohdr", input.admin.organizationId);
  const files = normalizeAutoHDRSourceManifest(input.manifest);
  const prepared = await store.prepareSourceUpload({
    organizationId: input.admin.organizationId,
    bookingId: booking.id,
    propertyId: booking.propertyId,
    requestId: input.requestId,
    createdBy: input.admin.userId,
    files,
  });
  return {
    ok: true as const,
    sources: await presignCanonicalAutoHDRSources(input.admin.organizationId, prepared.sources),
  };
}

export async function acceptBookingAutoHDRSourceUpload(input: {
  admin: AdminContext;
  bookingId: string;
  sources: unknown;
  requestId: string;
  signal: AbortSignal;
}) {
  input.signal.throwIfAborted();
  const store = createAutoHDRJobStore();
  const booking = await requireScopedBooking(store, input.bookingId, input.admin.organizationId);
  // Browser-returned state and object identities are never authoritative.
  // Re-run the idempotent prepare RPC so resume decisions use current DB rows.
  const manifest = normalizeAutoHDRSourceManifest(input.sources);
  const prepared = await store.prepareSourceUpload({
    organizationId: input.admin.organizationId,
    bookingId: booking.id,
    propertyId: booking.propertyId,
    requestId: input.requestId,
    createdBy: input.admin.userId,
    files: manifest,
  });
  const sources = prepared.sources;
  const storage = createProductionR2Storage(input.admin.organizationId);
  const ingestion = await ingestAutoHDRSourceFiles({
    organizationId: input.admin.organizationId,
    bookingId: booking.id,
    propertyId: booking.propertyId,
    sources,
    storage,
    store,
    verifyImage: verifyCanonicalImageStream,
    signal: input.signal,
    perFileTimeoutMs: SOURCE_FILE_TIMEOUT_MS,
  });
  return { ok: true as const, ...ingestion };
}

export async function finalizeBookingAutoHDR(input: {
  admin: AdminContext;
  bookingId: string;
  jobId: string;
}) {
  return application().finalize(input);
}

export async function refreshBookingAutoHDR(input: {
  admin: AdminContext;
  bookingId: string;
  jobId: string;
}) {
  return application().refresh(input);
}

export async function retrieveBookingAutoHDR(input: {
  admin: AdminContext;
  bookingId: string;
  jobId: string;
}) {
  return application().retrieve(input);
}

export async function listBookingAutoHDRJobs(input: {
  admin: AdminContext;
  bookingId: string;
}) {
  return createAutoHDRJobStore().listJobs(input.admin.organizationId, input.bookingId);
}

async function requireScopedBooking(
  store: ReturnType<typeof createAutoHDRJobStore>,
  bookingId: string,
  organizationId: string,
) {
  const booking = await store.loadBooking(bookingId, organizationId);
  if (!booking || booking.id !== bookingId || booking.organizationId !== organizationId) {
    throw new AutoHDRWorkflowError("booking_not_found", "Booking not found.", 404);
  }
  return booking;
}
