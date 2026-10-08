// One newly approved post-fix operation, sourced from the consumed diagnostic.
// Prior operation IDs and reports remain consumed. Never generate an ID on retry.
export const PREPARATION_CHECK_SOURCE = "b02f0969-4523-4c3b-afd5-28713cffcd01";
export const PREPARATION_CHECK_OPERATION = "1e2d1c53-403a-40cc-a108-5cbce90bcafc";
export const PREPARATION_CHECK_STORAGE = `pixel-blaster-preparation-only:${PREPARATION_CHECK_OPERATION}`;

const stages = ["provider_create", "capability_validation", "provider_read", "restriction_verification"];
const checkNames = ["success", "uid", "allowedOrigin", "maxDuration", "expiry", "creator", "claimMetadata",
  "uidPresent", "uidValid", "capabilityPresent", "capabilityWithinLength", "capabilityParseable",
  "capabilityHttps", "capabilityNoCredentials", "capabilityDefaultPort", "capabilityNoFragment",
  "capabilityAllowedHost", "capabilityPath"];
const expiryNames = ["present", "parseable", "exactMatch", "sameWholeSecond"];
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function booleans(value: unknown, names: string[]) {
  const object = record(value);
  return Object.fromEntries(names.filter(name => typeof object[name] === "boolean").map(name => [name, object[name] as boolean]));
}
function status(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
function inspection(value: unknown) {
  const data = record(value);
  if (typeof data.stage !== "string" || !stages.includes(data.stage)) return null;
  return { verified: data.verified === true, stage: data.stage, httpStatus: status(data.httpStatus),
    checks: booleans(data.checks, checkNames), expiryChecks: booleans(data.expiryChecks, expiryNames) };
}
export function preparationCheckReport(value: unknown, httpStatus: number | null) {
  const body = record(value);
  return { operationId: PREPARATION_CHECK_OPERATION, httpStatus: status(httpStatus),
    prepared: httpStatus === null ? null : httpStatus >= 200 && httpStatus < 300
      && typeof body.uploadUrl === "string" && typeof body.exampleId === "string",
    inspection: inspection(body.inspection), videoBytesSent: 0 as const, retryAllowed: false as const };
}
export type PreparationCheckReport = ReturnType<typeof preparationCheckReport>;

export function readPreparationCheckReport(saved: string | null): PreparationCheckReport | null {
  try {
    const body = record(JSON.parse(saved ?? ""));
    if (body.operationId !== PREPARATION_CHECK_OPERATION || body.videoBytesSent !== 0 || body.retryAllowed !== false
        || (typeof body.prepared !== "boolean" && body.prepared !== null)) return null;
    return { operationId: PREPARATION_CHECK_OPERATION, httpStatus: status(body.httpStatus), prepared: body.prepared,
      inspection: inspection(body.inspection), videoBytesSent: 0, retryAllowed: false };
  } catch { return null; }
}
