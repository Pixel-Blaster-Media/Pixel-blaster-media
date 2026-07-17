export function shouldHandoffAuthCode(path: string, hasCode: boolean): boolean {
  return (
    hasCode &&
    path !== "/auth/callback" &&
    path !== "/auth/recovery/callback" &&
    !path.startsWith("/api/")
  );
}
