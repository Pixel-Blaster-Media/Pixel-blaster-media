export function missingGrantedScopes(
  grantedScopes: string | undefined,
  requiredScopes: readonly string[],
): string[] {
  const granted = new Set(
    (grantedScopes ?? "")
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
  return requiredScopes.filter((scope) => !granted.has(scope));
}
