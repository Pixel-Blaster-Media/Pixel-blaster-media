export function mergeCredentialFields(
  existing: Record<string, string>,
  fields: Record<string, string>,
): Record<string, string> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = (value ?? "").trim();
    if (trimmed) merged[key] = trimmed;
  }
  return merged;
}

export async function resolveCredentialStrict(input: {
  field: string;
  organizationId: string;
  defaultOrganizationId: string;
  loadProvider: () => Promise<Record<string, string>>;
  environmentValue: () => string | undefined;
}): Promise<string | null> {
  const row = await input.loadProvider();
  const fromDb = row[input.field]?.trim();
  if (fromDb) return fromDb;
  const fromEnv =
    input.organizationId === input.defaultOrganizationId
      ? input.environmentValue()?.trim()
      : undefined;
  return fromEnv || null;
}
