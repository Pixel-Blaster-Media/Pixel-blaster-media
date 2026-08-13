import "server-only";

import { AutoHDRWorkflowError } from "./application-core";

export function requireAutoHDRSourceMutationEnabled(): void {
  const browserUploadsEnabled = process.env.MEDIA_R2_BROWSER_UPLOADS_ENABLED === "true";
  const quarantineWorkflowEnabled = process.env.AUTOHDR_QUARANTINE_WORKFLOW_ENABLED === "true";

  if (!browserUploadsEnabled || !quarantineWorkflowEnabled) {
    throw new AutoHDRWorkflowError(
      "source_workflow_disabled",
      "AutoHDR source processing is unavailable.",
      503,
    );
  }
}
