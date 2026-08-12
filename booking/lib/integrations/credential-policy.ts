export const INTEGRATION_CREDENTIAL_FIELDS = Object.freeze({
  admin_settings: Object.freeze(["today_command_preferences"]),
  autohdr: Object.freeze(["api_key", "enabled"]),
  autoenhance: Object.freeze(["api_key", "webhook_secret", "enabled"]),
  fotello: Object.freeze(["api_key"]),
  google_maps: Object.freeze(["api_key"]),
  iguide: Object.freeze(["app_id", "app_token", "webhook_secret"]),
  openai: Object.freeze(["api_key", "model"]),
  resend: Object.freeze(["api_key"]),
} as const);

export type IntegrationCredentialProvider = keyof typeof INTEGRATION_CREDENTIAL_FIELDS;

export function isIntegrationCredentialProvider(
  value: string,
): value is IntegrationCredentialProvider {
  return Object.prototype.hasOwnProperty.call(INTEGRATION_CREDENTIAL_FIELDS, value);
}

export function filterIntegrationCredentialFields(
  provider: IntegrationCredentialProvider,
  rawFields: Record<string, unknown>,
): Record<string, string> {
  const allowed = new Set<string>(INTEGRATION_CREDENTIAL_FIELDS[provider]);
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    if (allowed.has(key) && typeof value === "string") fields[key] = value;
  }
  return fields;
}

export function filterIntegrationCredentialFieldNames(
  provider: IntegrationCredentialProvider,
  fields: unknown[],
): string[] {
  const allowed = new Set<string>(INTEGRATION_CREDENTIAL_FIELDS[provider]);
  return fields.filter(
    (field): field is string => typeof field === "string" && allowed.has(field),
  );
}
