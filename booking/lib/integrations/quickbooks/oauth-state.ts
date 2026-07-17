import { createHash, randomBytes, timingSafeEqual } from "crypto";

function adminBinding(userId: string, organizationId: string): string {
  return createHash("sha256")
    .update(JSON.stringify([userId, organizationId]), "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function buildQuickBooksOAuthState(
  userId: string,
  organizationId: string,
): string {
  const nonce = randomBytes(24).toString("hex");
  return `${nonce}.${adminBinding(userId, organizationId)}`;
}

export function quickBooksOAuthStateMatchesAdmin(
  state: string,
  userId: string,
  organizationId: string,
): boolean {
  const match = /^([a-f0-9]{48})\.([a-f0-9]{32})$/.exec(state);
  if (!match) return false;

  const actual = Buffer.from(match[2], "hex");
  const expected = Buffer.from(adminBinding(userId, organizationId), "hex");
  return timingSafeEqual(actual, expected);
}
