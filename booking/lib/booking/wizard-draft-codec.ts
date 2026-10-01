import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { WizardState } from "./wizard-state";

export type PrivateWizardProperty = Pick<WizardState, "streetAddress" | "unitNumber" | "city" | "postalCode" | "squareFootage" | "isVacant" | "includeBasement" | "shotRequests" | "shootNotes">;
export const DRAFT_TTL_SECONDS = 2 * 60 * 60;
export interface CompletedWizardReceipt {
  redirectTo: string;
  receipt: { address: string; when: string; services: string[]; organizationName: string };
}
// AES-GCM/base64 expansion keeps each cookie below 3.2 KB, including its name.
const MAX_PLAINTEXT_BYTES = 2300;

export function normalizePrivateProperty(input: unknown): PrivateWizardProperty {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Property details are invalid.");
  const p = input as Record<string, unknown>;
  const text = (name: string, max: number) => {
    const value = p[name] ?? "";
    if (typeof value !== "string" || value.length > max) throw new Error("Property details are too long. Please shorten the address or notes.");
    return value.trim();
  };
  const sqft = p.squareFootage ?? null;
  if (sqft !== null && (typeof sqft !== "number" || !Number.isSafeInteger(sqft) || sqft <= 0 || sqft > 1_000_000)) throw new Error("Enter a valid square footage or leave it blank.");
  if (p.isVacant != null && (typeof p.isVacant !== "string" || !["vacant", "occupied", "partial"].includes(p.isVacant))) throw new Error("Choose a valid occupancy option.");
  if (p.includeBasement != null && typeof p.includeBasement !== "boolean") throw new Error("Choose a valid basement option.");
  const shots = p.shotRequests ?? [];
  if (!Array.isArray(shots) || shots.length > 12 || !shots.every((shot) => typeof shot === "string" && shot.length <= 50)) throw new Error("Shot requests are invalid.");
  return {
    streetAddress: text("streetAddress", 300), unitNumber: text("unitNumber", 100), city: text("city", 100),
    postalCode: text("postalCode", 30), shootNotes: text("shootNotes", 1600),
    squareFootage: sqft as number | null, isVacant: (p.isVacant ?? null) as PrivateWizardProperty["isVacant"],
    includeBasement: (p.includeBasement ?? null) as boolean | null, shotRequests: [...new Set(shots as string[])],
  };
}

function key(secret: string): Buffer {
  if (!secret) throw new Error("Private booking drafts are temporarily unavailable.");
  return createHash("sha256").update("pixel-booking-private-draft-v1\0").update(secret).digest();
}

export function sealWizardDraft(property: PrivateWizardProperty, secret: string, binding: string, now = Date.now()): string {
  return sealPayload({ property }, secret, binding, now);
}

export function sealWizardReceipt(completed: CompletedWizardReceipt, secret: string, binding: string, now = Date.now()): string {
  return sealPayload({ completed: normalizeReceipt(completed) }, secret, binding, now);
}

function sealPayload(payload: object, secret: string, binding: string, now: number): string {
  const plaintext = Buffer.from(JSON.stringify({ ...payload, expires: now + DRAFT_TTL_SECONDS * 1000 }));
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error("Property details are too long to save. Please shorten the notes and try again.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function openWizardDraft(value: string, secret: string, binding: string, now = Date.now()): PrivateWizardProperty | null {
  try { return normalizePrivateProperty(openPayload(value, secret, binding, now)?.property); }
  catch { return null; }
}

export function openWizardReceipt(value: string, secret: string, binding: string, now = Date.now()): CompletedWizardReceipt | null {
  try { return normalizeReceipt(openPayload(value, secret, binding, now)?.completed); }
  catch { return null; }
}

function normalizeReceipt(value: unknown): CompletedWizardReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid receipt");
  const completed = value as Record<string, unknown>;
  const receipt = completed.receipt as Record<string, unknown> | undefined;
  if (typeof completed.redirectTo !== "string" ||
      !/^\/(?:portal\/[^/?#]+\?booked=1|book\/success\?[^\r\n\\]*)$/.test(completed.redirectTo) ||
      !receipt || typeof receipt.address !== "string" || typeof receipt.when !== "string" ||
      typeof receipt.organizationName !== "string" || !Array.isArray(receipt.services) ||
      !receipt.services.every((service) => typeof service === "string")) throw new Error("Invalid receipt");
  // Copy only receipt fields. Never retain access notes, occupancy or other draft data.
  return { redirectTo: completed.redirectTo, receipt: { address: receipt.address,
    when: receipt.when, organizationName: receipt.organizationName, services: [...receipt.services] } };
}

function openPayload(value: string, secret: string, binding: string, now: number): Record<string, unknown> | null {
  try {
    if (!/^[A-Za-z0-9_-]{40,3200}$/.test(value)) return null;
    const bytes = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(secret), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const decoded = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    if (!Number.isFinite(decoded.expires) || decoded.expires <= now || decoded.expires > now + DRAFT_TTL_SECONDS * 1000) return null;
    return decoded;
  } catch { return null; }
}
