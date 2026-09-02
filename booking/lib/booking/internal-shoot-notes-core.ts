export const MAX_INTERNAL_SHOOT_NOTES_LENGTH = 2_000;

export interface InternalShootNotesSnapshot {
  notes: string | null;
  revision: number;
}

export type NormalizedInternalShootNotes =
  | { ok: true; notes: string | null }
  | { ok: false; error: string };

export type InternalShootNotesMutationResult =
  | { ok: true; notes: string | null; revision: number }
  | { ok: false; error: string; conflict?: false }
  | {
      ok: false;
      error: string;
      conflict: true;
      notes: string | null;
      revision: number;
    };

export type InternalShootNotesStoreResult =
  | { status: "saved"; notes: string | null; revision: number }
  | { status: "conflict"; notes: string | null; revision: number }
  | { status: "not_found" }
  | { status: "error" };

export interface InternalShootNotesStore {
  updateInternalNotes(input: {
    organizationId: string;
    bookingId: string;
    actorId: string;
    expectedRevision: number;
    notes: string | null;
  }): Promise<InternalShootNotesStoreResult>;
}

export function internalShootNotesLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeInternalShootNotes(
  value: unknown,
): NormalizedInternalShootNotes {
  if (typeof value !== "string") {
    return { ok: false, error: "Enter a valid private shoot note." };
  }

  const notes = value.trim();
  if (internalShootNotesLength(notes) > MAX_INTERNAL_SHOOT_NOTES_LENGTH) {
    return {
      ok: false,
      error: "Private shoot notes must be 2,000 characters or fewer.",
    };
  }

  return { ok: true, notes: notes || null };
}

export async function updateInternalShootNotes(args: {
  organizationId: string;
  bookingId: string;
  actorId: string;
  expectedRevision: unknown;
  value: unknown;
  store: InternalShootNotesStore;
}): Promise<InternalShootNotesMutationResult> {
  if (
    typeof args.expectedRevision !== "number" ||
    !Number.isSafeInteger(args.expectedRevision) ||
    args.expectedRevision < 0
  ) {
    return { ok: false, error: "Refresh this booking and try again." };
  }

  const normalized = normalizeInternalShootNotes(args.value);
  if (!normalized.ok) return normalized;

  const result = await args.store.updateInternalNotes({
    organizationId: args.organizationId,
    bookingId: args.bookingId,
    actorId: args.actorId,
    expectedRevision: args.expectedRevision,
    notes: normalized.notes,
  });
  if (result.status === "not_found") {
    return { ok: false, error: "Booking not found." };
  }
  if (result.status === "conflict") {
    return {
      ok: false,
      error:
        "This private shoot note changed elsewhere. Your draft was kept; review the latest note before saving again.",
      conflict: true,
      notes: result.notes,
      revision: result.revision,
    };
  }
  if (result.status !== "saved") {
    return { ok: false, error: "Could not save the private shoot note." };
  }
  return {
    ok: true,
    notes: result.notes,
    revision: result.revision,
  };
}
