import "server-only";

import { getCredential } from "@/lib/integrations/credentials";
import { requirePhotoEditingProviderEnabled } from "@/lib/integrations/provider-enablement";

import { resolveAutoHDRClient } from "./client-core";

export async function getAutoHDRClient(organizationId: string) {
  await requirePhotoEditingProviderEnabled("autohdr", organizationId);
  return resolveAutoHDRClient({ organizationId, getCredential });
}
