function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function uniqueEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const email of emails) {
    const normalized = normalizeEmail(email);
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

export function ccRecipientsFor(
  primaryRecipient: string,
  savedRecipients: readonly string[] | null | undefined,
): string[] {
  const primary = normalizeEmail(primaryRecipient);
  return uniqueEmails(savedRecipients ?? []).filter((email) => email !== primary);
}
