export function isMissingSessionError(
  error: { name?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  return (
    error.name === "AuthSessionMissingError" ||
    (error.message ?? "").toLowerCase().includes("auth session missing")
  );
}

export function isUnavailableAuthError(
  error: { name?: string; status?: number; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  return (
    error.status === 0 ||
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.code === "auth_transport_unavailable" ||
    (typeof error.status === "number" && error.status >= 500) ||
    error.name?.includes("Retryable") === true ||
    error.name === "AuthUnknownError"
  );
}
