import {
  updateInternalShootNotes,
  type InternalShootNotesMutationResult,
  type InternalShootNotesSnapshot,
  type InternalShootNotesStoreResult,
} from "@/lib/booking/internal-shoot-notes-core";
import { getServiceSupabase } from "@/lib/supabase/server";

interface InternalShootNotesRow {
  booking_id: string;
  notes: string | null;
  revision: number;
}

interface InternalShootNotesRpcRow {
  result_status: string;
  result_notes: string | null;
  result_revision: number | null;
}

const EMPTY_INTERNAL_SHOOT_NOTES: InternalShootNotesSnapshot = {
  notes: null,
  revision: 0,
};

export async function loadBookingInternalNotes(args: {
  organizationId: string;
  actorId: string;
  bookingIds: readonly string[];
}): Promise<Map<string, InternalShootNotesSnapshot>> {
  const bookingIds = [...new Set(args.bookingIds)];
  if (bookingIds.length === 0) return new Map();
  if (bookingIds.length > 1_000) {
    throw new Error("Private shoot-note read exceeded its booking bound.");
  }

  const { data, error } = await getServiceSupabase()
    .rpc("get_booking_internal_notes", {
      p_organization_id: args.organizationId,
      p_booking_ids: bookingIds,
      p_actor_id: args.actorId,
    });
  if (error || !Array.isArray(data)) {
    throw new Error("Could not load private shoot notes.");
  }

  const notes = new Map<string, InternalShootNotesSnapshot>();
  for (const row of data as InternalShootNotesRow[]) {
    if (
      !bookingIds.includes(row.booking_id) ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1
    ) {
      throw new Error("Private shoot-note data was invalid.");
    }
    notes.set(row.booking_id, {
      notes: row.notes,
      revision: row.revision,
    });
  }
  return notes;
}

export async function loadBookingInternalNote(args: {
  organizationId: string;
  bookingId: string;
  actorId: string;
}): Promise<InternalShootNotesSnapshot> {
  const notes = await loadBookingInternalNotes({
    organizationId: args.organizationId,
    actorId: args.actorId,
    bookingIds: [args.bookingId],
  });
  return notes.get(args.bookingId) ?? EMPTY_INTERNAL_SHOOT_NOTES;
}

export async function updateBookingInternalNotes(args: {
  organizationId: string;
  bookingId: string;
  actorId: string;
  expectedRevision: unknown;
  value: unknown;
}): Promise<InternalShootNotesMutationResult> {
  return updateInternalShootNotes({
    ...args,
    store: {
      async updateInternalNotes(input): Promise<InternalShootNotesStoreResult> {
        const { data, error } = await getServiceSupabase().rpc(
          "update_booking_internal_notes",
          {
            p_organization_id: input.organizationId,
            p_booking_id: input.bookingId,
            p_expected_revision: input.expectedRevision,
            p_notes: input.notes,
            p_actor_id: input.actorId,
          },
        );
        if (error || !Array.isArray(data) || data.length !== 1) {
          return { status: "error" };
        }

        const row = data[0] as InternalShootNotesRpcRow;
        if (row.result_status === "not_found") return { status: "not_found" };
        if (
          row.result_status === "saved" ||
          row.result_status === "conflict"
        ) {
          if (
            !Number.isSafeInteger(row.result_revision) ||
            (row.result_revision ?? 0) < 1 ||
            (row.result_notes !== null && typeof row.result_notes !== "string")
          ) {
            return { status: "error" };
          }
          return {
            status: row.result_status,
            notes: row.result_notes,
            revision: row.result_revision as number,
          };
        }
        return { status: "error" };
      },
    },
  });
}
