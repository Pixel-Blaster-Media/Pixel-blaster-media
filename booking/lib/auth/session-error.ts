export function isMissingSessionError(
  error: { name?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  return (
    error.name === "AuthSessionMissingError" ||
    (error.message ?? "").toLowerCase().includes("auth session missing")
  );
}
