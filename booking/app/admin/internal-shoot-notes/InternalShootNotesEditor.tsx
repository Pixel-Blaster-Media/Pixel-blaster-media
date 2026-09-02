"use client";

import { useRouter } from "next/navigation";

import { saveInternalShootNotes } from "./actions";
import { InternalShootNotesEditorView } from "./InternalShootNotesEditorView";

export default function InternalShootNotesEditor({
  bookingId,
  draftScope,
  initialNotes,
  initialRevision,
}: {
  bookingId: string;
  draftScope: string;
  initialNotes: string | null;
  initialRevision: number;
}) {
  const router = useRouter();
  return (
    <InternalShootNotesEditorView
      bookingId={bookingId}
      draftScope={draftScope}
      initialNotes={initialNotes}
      initialRevision={initialRevision}
      saveAction={saveInternalShootNotes}
      refreshAction={() => router.refresh()}
    />
  );
}
