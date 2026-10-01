"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { resolvePublicBookingOrganization } from "@/lib/organizations/public-booking";
import { publicWizardQuery } from "@/lib/booking/wizard-state";
import { DRAFT_TTL_SECONDS, normalizePrivateProperty, openWizardDraft, sealWizardDraft } from "@/lib/booking/wizard-draft-codec";
import { WIZARD_DRAFT_COOKIE_PREFIX, wizardDraftSecret } from "@/lib/booking/wizard-draft";

export async function saveBookingWizardDraft(input: { query: string; property: unknown }): Promise<{ ok: true; query: string } | { ok: false; error: string }> {
  if (!input || typeof input.query !== "string" || input.query.length > 4000) return { ok: false, error: "Booking selections are invalid." };
  const query = publicWizardQuery(new URLSearchParams(input.query));
  const organization = await resolvePublicBookingOrganization(query.get("org"));
  if (!organization) return { ok: false, error: "This booking company is unavailable." };
  let property;
  try { property = normalizePrivateProperty(input.property); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Property details are invalid." }; }
  const store = await cookies();
  const secret = wizardDraftSecret();
  const previousId = query.get("draft");
  const previous = previousId ? store.get(WIZARD_DRAFT_COOKIE_PREFIX + previousId)?.value : null;
  // Reuse only a draft this browser actually owns, scoped to the resolved company.
  const draftId = previousId && previous && openWizardDraft(previous, secret, `${organization.id}:${previousId}`)
    ? previousId : randomUUID();
  let value;
  try { value = sealWizardDraft(property, secret, `${organization.id}:${draftId}`); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Property details could not be saved." }; }
  const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/book", maxAge: DRAFT_TTL_SECONDS };
  // Keep two active flows; bounded cookies avoid an ever-growing request header.
  const others = store.getAll().filter((cookie) => cookie.name.startsWith(WIZARD_DRAFT_COOKIE_PREFIX) && cookie.name !== WIZARD_DRAFT_COOKIE_PREFIX + draftId);
  for (const cookie of others.slice(0, -1)) store.set(cookie.name, "", { ...options, maxAge: 0 });
  store.set(WIZARD_DRAFT_COOKIE_PREFIX + draftId, value, options);
  query.set("org", organization.slug);
  query.set("draft", draftId);
  query.delete("slot");
  return { ok: true, query: query.toString() };
}
