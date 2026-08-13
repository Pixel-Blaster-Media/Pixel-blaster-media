import "server-only";

import { createAutoHDRSourceWorkerStore } from "./database-adapter";
import { createProductionR2Storage } from "../../media/storage/r2";
import { requireAutoHDRSourceMutationEnabled } from "./source-mutation-gate";
import { verifyCanonicalImageStream } from "./source-image-verification";
import { runAutoHDRQuarantineCleanup, runOneAutoHDRSourceFile } from "./source-worker-core";

const LEASE_SECONDS = 60;
const FILE_TIMEOUT_MS = 45_000;

export async function runBoundedAutoHDRSourceWorker() {
  requireAutoHDRSourceMutationEnabled();
  const store = createAutoHDRSourceWorkerStore();
  const organizations = await store.listSourceOrganizations(100);
  for (const organizationId of organizations) {
    const result = await runOneAutoHDRSourceFile({
      organizationId, workerId: `vercel-source-${crypto.randomUUID()}`,
      leaseSeconds: LEASE_SECONDS, timeoutMs: FILE_TIMEOUT_MS, store,
      storage: createProductionR2Storage(organizationId), verifyImage: verifyCanonicalImageStream,
    });
    if (result.status !== "idle") return result;
  }
  return { status: "idle" as const };
}

export async function runBoundedAutoHDRQuarantineCleanup() {
  requireAutoHDRSourceMutationEnabled();
  const store = createAutoHDRSourceWorkerStore();
  return runAutoHDRQuarantineCleanup({
    limit: 20, leaseSeconds: LEASE_SECONDS, maxAttempts: 5,
    timeoutMs: 15_000, store, storageFor: createProductionR2Storage,
  });
}
