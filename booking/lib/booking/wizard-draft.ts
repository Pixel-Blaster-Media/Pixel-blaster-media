import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DRAFT_TTL_SECONDS, openWizardDraft, openWizardReceipt, sealWizardReceipt, type CompletedWizardReceipt } from "./wizard-draft-codec";
import { PRIVATE_WIZARD_QUERY_KEYS, parseWizardState, serializeWizardState, type WizardState } from "./wizard-state";

export const WIZARD_DRAFT_COOKIE_PREFIX = "pb_booking_draft_";
export function wizardDraftSecret(): string {
  return process.env.BOOKING_MANAGE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

export function readPublicWizardState(raw: Record<string, string | string[] | undefined>, path: string): WizardState {
  const clean = { ...raw };
  for (const name of PRIVATE_WIZARD_QUERY_KEYS) delete clean[name];
  const state = parseWizardState(clean);
  if (PRIVATE_WIZARD_QUERY_KEYS.some((name) => raw[name] !== undefined)) {
    // Existing URLs cannot be erased from old logs/history; never forward their details.
    const query = serializeWizardState(state);
    query.set("draft_notice", "private_details_required");
    redirect(`${path}?${query.toString()}`);
  }
  return state;
}

export async function loadPrivateWizardState(state: WizardState, organizationId: string): Promise<WizardState> {
  if (!state.draftId) return state;
  if (await loadCompletedWizardReceipt(state.draftId, organizationId)) {
    redirect(`/book/confirm?${serializeWizardState(state).toString()}`);
  }
  const value = (await cookies()).get(WIZARD_DRAFT_COOKIE_PREFIX + state.draftId)?.value;
  const property = value ? openWizardDraft(value, wizardDraftSecret(), `${organizationId}:${state.draftId}`) : null;
  return property ? { ...state, ...property } : state;
}

export async function loadCompletedWizardReceipt(draftId: string | null | undefined, organizationId: string): Promise<CompletedWizardReceipt | null> {
  if (!draftId) return null;
  const value = (await cookies()).get(WIZARD_DRAFT_COOKIE_PREFIX + draftId)?.value;
  return value ? openWizardReceipt(value, wizardDraftSecret(), `${organizationId}:${draftId}`) : null;
}

export async function hasActivePrivateWizardDraft(draftId: string, organizationId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(draftId)) return false;
  const value = (await cookies()).get(WIZARD_DRAFT_COOKIE_PREFIX + draftId)?.value;
  return Boolean(value && openWizardDraft(value, wizardDraftSecret(), `${organizationId}:${draftId}`));
}

/** Replace the committed draft with a minimal receipt, never delete the state
 * required by Next's cookie-triggered Server Action render. Reload/back also
 * show completion instead of inviting the customer to book a second time.
 * Call ONLY after the booking RPC has authorized and committed/replayed it.
 * That authorization, not a possibly expired draft, permits this receipt. */
export async function completePrivateWizardDraft(draftId: string, organizationId: string, completed: CompletedWizardReceipt): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(draftId)) return;
  try {
    const store = await cookies();
    const name = WIZARD_DRAFT_COOKIE_PREFIX + draftId;
    const secret = wizardDraftSecret();
    const binding = `${organizationId}:${draftId}`;
    const value = sealWizardReceipt(completed, secret, binding);
    const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/book", maxAge: DRAFT_TTL_SECONDS };
    const others = store.getAll().filter(cookie => cookie.name.startsWith(WIZARD_DRAFT_COOKIE_PREFIX) && cookie.name !== name);
    for (const cookie of others.slice(0, -1)) store.set(cookie.name, "", { ...options, maxAge: 0 });
    store.set(name, value, options);
  } catch { /* Preserve the draft/inline receipt if completion storage is unavailable. */ }
}

export async function clearPrivateWizardDraft(draftId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(draftId)) return;
  try {
    (await cookies()).set(WIZARD_DRAFT_COOKIE_PREFIX + draftId, "", {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/book", maxAge: 0,
    });
  } catch { /* Cleanup must not turn a committed booking into a reported failure. */ }
}
