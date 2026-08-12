import "server-only";

import { getCredentialStrict } from "@/lib/integrations/credentials";
import {
  resolveProviderEnabled,
  type PhotoEditingProvider,
} from "@/lib/integrations/provider-enablement-core";

const PROVIDER_ENV: Record<PhotoEditingProvider, string> = {
  autohdr: "AUTOHDR_ENABLED",
  autoenhance: "AUTOENHANCE_ENABLED",
};

export async function isPhotoEditingProviderEnabled(
  provider: PhotoEditingProvider,
  organizationId: string,
): Promise<boolean> {
  return resolveProviderEnabled({
    provider,
    organizationId,
    envVar: PROVIDER_ENV[provider] as "AUTOHDR_ENABLED" | "AUTOENHANCE_ENABLED",
    getCredential: getCredentialStrict,
  });
}

export async function requirePhotoEditingProviderEnabled(
  provider: PhotoEditingProvider,
  organizationId: string,
): Promise<void> {
  if (!(await isPhotoEditingProviderEnabled(provider, organizationId))) {
    const name = provider === "autohdr" ? "AutoHDR" : "Autoenhance";
    throw new Error(`${name} is disabled in Settings → Connections.`);
  }
}
