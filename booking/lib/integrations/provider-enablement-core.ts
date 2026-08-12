export type PhotoEditingProvider = "autohdr" | "autoenhance";

export function parseProviderEnabled(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function providerEnabledField(enabled: boolean): Record<string, string> {
  return { enabled: enabled ? "true" : "false" };
}

export async function resolveProviderEnabled(input: {
  provider: PhotoEditingProvider;
  organizationId: string;
  envVar: "AUTOHDR_ENABLED" | "AUTOENHANCE_ENABLED";
  getCredential: (
    provider: PhotoEditingProvider,
    field: "enabled",
    envVar: string,
    organizationId: string,
  ) => Promise<string | null>;
}): Promise<boolean> {
  const value = await input.getCredential(
    input.provider,
    "enabled",
    input.envVar,
    input.organizationId,
  );
  return parseProviderEnabled(value);
}
