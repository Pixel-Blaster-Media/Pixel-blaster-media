import "server-only";

import { getCredential } from "@/lib/integrations/credentials";
import { createProductionR2Storage } from "@/lib/media/storage/r2";

import { createAutoHDRJobStore } from "./database-adapter";

export type AutoHDRRuntimeReadiness = Readonly<{
  ready: boolean;
  prerequisites: readonly string[];
}>;

export async function getAutoHDRRuntimeReadiness(
  organizationId: string,
): Promise<AutoHDRRuntimeReadiness> {
  const prerequisites: string[] = [];
  const browserUploadsReady = process.env.MEDIA_R2_BROWSER_UPLOADS_ENABLED === "true";
  if (!browserUploadsReady) {
    prerequisites.push("Production R2 browser-upload CORS verification");
  }
  const quarantineWorkflowReady = process.env.AUTOHDR_QUARANTINE_WORKFLOW_ENABLED === "true";
  if (!quarantineWorkflowReady) {
    prerequisites.push("Quarantine-first source ingestion and recovery verification");
  }
  let storageReady = false;
  try {
    createProductionR2Storage(organizationId);
    storageReady = true;
  } catch {
    prerequisites.push("Private production storage");
  }
  const [apiKey, schemaReady] = await Promise.all([
    getCredential("autohdr", "api_key", "AUTOHDR_API_KEY", organizationId).catch(() => null),
    createAutoHDRJobStore().probeSchema(organizationId).catch(() => false),
  ]);
  if (!apiKey) prerequisites.push("AutoHDR API key");
  if (!schemaReady) prerequisites.push("Canonical media and AutoHDR job schema");
  return Object.freeze({
    ready: storageReady && browserUploadsReady && quarantineWorkflowReady && Boolean(apiKey) && schemaReady,
    prerequisites: Object.freeze(prerequisites),
  });
}
