import "server-only";

import type { AdminContext } from "@/lib/auth/require-admin";
import { requirePhotoEditingProviderEnabled } from "@/lib/integrations/provider-enablement";

import { createAutoHDRApplication } from "./application-core";
import { getAutoHDRClient } from "./client";
import { createAutoHDRJobStore } from "./database-adapter";

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
  manifest: Array<{ name: unknown; size: unknown; lastModified: unknown }>;
  style: unknown;
}) {
  return application().prepare(input);
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
