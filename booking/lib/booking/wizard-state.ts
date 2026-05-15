/**
 * Shared URL-state helpers for the /book wizard.
 *
 * The wizard keeps all state in query params so:
 *   - Back button works naturally between steps
 *   - Pages can be shared / bookmarked at any step
 *   - Server components can read state without client hydration
 *
 * Every step page reads the same query params, validates prior-step
 * completeness, and redirects back to the earliest incomplete step if
 * the user tries to skip ahead.
 */

export type VacancyState = "vacant" | "occupied" | "partial";

export interface WizardState {
  /** Booking company handle. Omitted means the default Pixel Blaster tenant. */
  organizationSlug: string | null;
  /** Step 1 — bundle + a-la-carte slugs (separate from add_ons for video gating). */
  services: string[];
  /** Step 1 — add-on slugs (on_camera, etc.). */
  addOns: string[];
  /** Step 2 — street + unit + city + postal. */
  streetAddress: string;
  unitNumber: string;
  city: string;
  postalCode: string;
  squareFootage: number | null;
  isVacant: VacancyState | null;
  includeBasement: boolean | null;
  /** Step 2 — agent-requested must-have shots and context. */
  shotRequests: string[];
  shootNotes: string;
  /** Step 3 — chosen ISO-UTC slot start. */
  slot: string | null;
}

export type StepId = 1 | 2 | 3 | 4;

export function parseWizardState(
  raw: Record<string, string | string[] | undefined>,
): WizardState {
  return {
    organizationSlug: organizationSlug(raw.org),
    services: parseCsv(raw.services),
    addOns: parseCsv(raw.add_ons),
    streetAddress: str(raw.address),
    unitNumber: str(raw.unit),
    city: str(raw.city),
    postalCode: str(raw.postal),
    squareFootage: intOrNull(raw.sqft),
    isVacant: vacancy(raw.vacant),
    includeBasement: boolOrNull(raw.basement),
    shotRequests: parseCsv(raw.shots),
    shootNotes: str(raw.shoot_notes),
    slot: str(raw.slot) || null,
  };
}

/** Serialize state back to query-param form for step-to-step navigation. */
export function serializeWizardState(s: Partial<WizardState>): URLSearchParams {
  const out = new URLSearchParams();
  if (s.organizationSlug) out.set("org", s.organizationSlug);
  if (s.services?.length) out.set("services", s.services.join(","));
  if (s.addOns?.length) out.set("add_ons", s.addOns.join(","));
  if (s.streetAddress) out.set("address", s.streetAddress);
  if (s.unitNumber) out.set("unit", s.unitNumber);
  if (s.city) out.set("city", s.city);
  if (s.postalCode) out.set("postal", s.postalCode);
  if (s.squareFootage != null) out.set("sqft", String(s.squareFootage));
  if (s.isVacant) out.set("vacant", s.isVacant);
  if (s.includeBasement != null) {
    out.set("basement", s.includeBasement ? "1" : "0");
  }
  if (s.shotRequests?.length) out.set("shots", s.shotRequests.join(","));
  if (s.shootNotes) out.set("shoot_notes", s.shootNotes);
  if (s.slot) out.set("slot", s.slot);
  return out;
}

export interface StepCompleteness {
  step1: boolean;
  step2: boolean;
  step3: boolean;
  /** Furthest step the user can be on right now without skipping. */
  maxReachable: StepId;
}

export function stepCompleteness(s: WizardState): StepCompleteness {
  const step1 = s.services.length > 0;
  const step2 = step1 && Boolean(s.streetAddress && s.city);
  const step3 = step2 && Boolean(s.slot);

  const maxReachable: StepId = step3 ? 4 : step2 ? 3 : step1 ? 2 : 1;
  return { step1, step2, step3, maxReachable };
}

export const WIZARD_STEPS = [
  { id: 1 as const, label: "Services", path: "/book" },
  { id: 2 as const, label: "Property", path: "/book/property" },
  { id: 3 as const, label: "When", path: "/book/schedule" },
  { id: 4 as const, label: "Confirm", path: "/book/confirm" },
] as const;

// ---- internal helpers ----

function str(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return (v[0] ?? "").trim();
  return (v ?? "").trim();
}

function parseCsv(v: string | string[] | undefined): string[] {
  const raw = Array.isArray(v) ? v.join(",") : v ?? "";
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function intOrNull(v: string | string[] | undefined): number | null {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function vacancy(v: string | string[] | undefined): VacancyState | null {
  const s = str(v);
  if (s === "vacant" || s === "occupied" || s === "partial") return s;
  return null;
}

function boolOrNull(v: string | string[] | undefined): boolean | null {
  const s = str(v);
  if (s === "1" || s === "true") return true;
  if (s === "0" || s === "false") return false;
  return null;
}

function organizationSlug(v: string | string[] | undefined): string | null {
  const s = str(v).toLowerCase();
  if (!s) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return null;
  return s.slice(0, 60);
}
