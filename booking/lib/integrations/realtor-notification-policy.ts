export type RealtorNotificationPolicy =
  | { ok: true; suppressed: boolean }
  | { ok: false };

/**
 * Provider dispatch is fail-closed: only an explicit database boolean may
 * authorize or suppress realtor-facing communication.
 */
export function parseRealtorNotificationPolicy(
  value: unknown,
): RealtorNotificationPolicy {
  if (typeof value !== "boolean") return { ok: false };
  return { ok: true, suppressed: value };
}
