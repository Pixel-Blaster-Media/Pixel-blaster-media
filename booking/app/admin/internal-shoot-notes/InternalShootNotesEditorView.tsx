"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  internalShootNotesLength,
  MAX_INTERNAL_SHOOT_NOTES_LENGTH,
} from "@/lib/booking/internal-shoot-notes-core";
import type { InternalShootNotesMutationResult } from "@/lib/booking/internal-shoot-notes-core";

export interface InternalShootNotesDraft {
  draft: string;
  baseRevision: number;
}

export interface InternalShootNotesDraftStore {
  load(key: string): InternalShootNotesDraft | null;
  save(key: string, value: InternalShootNotesDraft): void;
  clear(key: string): void;
}

export type InternalShootNotesSaveAction = (
  bookingId: string,
  value: string,
  expectedRevision: number,
) => Promise<InternalShootNotesMutationResult>;

const browserDraftStore: InternalShootNotesDraftStore = {
  load(key) {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<InternalShootNotesDraft>;
      if (
        typeof value.draft !== "string" ||
        internalShootNotesLength(value.draft) > MAX_INTERNAL_SHOOT_NOTES_LENGTH ||
        !Number.isSafeInteger(value.baseRevision) ||
        (value.baseRevision ?? -1) < 0
      ) {
        window.sessionStorage.removeItem(key);
        return null;
      }
      return {
        draft: value.draft,
        baseRevision: value.baseRevision as number,
      };
    } catch {
      return null;
    }
  },
  save(key, value) {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // A blocked/full storage area must not break the editor itself.
    }
  },
  clear(key) {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Best-effort browser draft cleanup; the server remains authoritative.
    }
  },
};

export function InternalShootNotesEditorView({
  bookingId,
  draftScope,
  initialNotes,
  initialRevision,
  saveAction,
  refreshAction,
  draftStore = browserDraftStore,
}: {
  bookingId: string;
  draftScope: string;
  initialNotes: string | null;
  initialRevision: number;
  saveAction: InternalShootNotesSaveAction;
  refreshAction: () => void;
  draftStore?: InternalShootNotesDraftStore;
}) {
  const headingId = useId();
  const fieldId = `${headingId}-field`;
  const helpId = `${headingId}-help`;
  const countId = `${headingId}-count`;
  const draftKey = `pb-private-shoot-notes:${draftScope}:${bookingId}`;
  const incomingNotes = initialNotes?.trim() ?? "";
  const [savedNotes, setSavedNotes] = useState(incomingNotes);
  const [savedRevision, setSavedRevision] = useState(initialRevision);
  const [draft, setDraft] = useState(incomingNotes);
  const [editing, setEditing] = useState(false);
  const [restored, setRestored] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const focusTriggerAfterEdit = useRef(false);
  const focusEditorAfterFailure = useRef(false);
  const draftBaseRevisionRef = useRef(initialRevision);
  const incomingSnapshotRef = useRef({
    notes: incomingNotes,
    revision: initialRevision,
  });
  const isDirty = editing && draft !== savedNotes;

  useEffect(() => {
    const stored = draftStore.load(draftKey);
    if (stored && stored.draft !== incomingNotes) {
      draftBaseRevisionRef.current = stored.baseRevision;
      setDraft(stored.draft);
      setEditing(true);
      setMessage("Your unsaved private-note draft was restored for this tab.");
      if (stored.baseRevision !== initialRevision) {
        setHasConflict(true);
        setError(
          "This private shoot note changed elsewhere. Your draft was kept; review the latest note before saving again.",
        );
      }
    }
    setRestored(true);
  }, [bookingId, draftKey, draftStore, incomingNotes, initialRevision]);

  useEffect(() => {
    if (
      incomingSnapshotRef.current.revision === initialRevision &&
      incomingSnapshotRef.current.notes === incomingNotes
    ) {
      return;
    }
    incomingSnapshotRef.current = {
      notes: incomingNotes,
      revision: initialRevision,
    };
    if (editing && draft !== savedNotes) {
      setSavedNotes(incomingNotes);
      setSavedRevision(initialRevision);
      setHasConflict(true);
      setError(
        "This private shoot note changed elsewhere. Your draft was kept; review the latest note before saving again.",
      );
      return;
    }
    setSavedNotes(incomingNotes);
    setSavedRevision(initialRevision);
    draftBaseRevisionRef.current = initialRevision;
    setDraft(incomingNotes);
    setHasConflict(false);
    setError(null);
  }, [
    draft,
    editing,
    incomingNotes,
    initialRevision,
    savedNotes,
    savedRevision,
  ]);

  useEffect(() => {
    if (!restored) return;
    if (isDirty) {
      draftStore.save(draftKey, {
        draft,
        baseRevision: draftBaseRevisionRef.current,
      });
    } else {
      draftStore.clear(draftKey);
    }
  }, [draft, draftKey, draftStore, isDirty, restored]);

  useEffect(() => {
    if (!isDirty || typeof window === "undefined") return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!editing && focusTriggerAfterEdit.current) {
      focusTriggerAfterEdit.current = false;
      triggerRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (!isPending && editing && focusEditorAfterFailure.current) {
      focusEditorAfterFailure.current = false;
      fieldRef.current?.focus();
    }
  }, [editing, error, isPending]);

  function beginEditing() {
    draftBaseRevisionRef.current = savedRevision;
    focusEditorAfterFailure.current = false;
    setDraft(savedNotes);
    setError(null);
    setMessage(null);
    setHasConflict(false);
    setEditing(true);
  }

  function cancelEditing() {
    draftStore.clear(draftKey);
    setDraft(savedNotes);
    setError(null);
    setMessage(null);
    setHasConflict(false);
    focusEditorAfterFailure.current = false;
    focusTriggerAfterEdit.current = true;
    setEditing(false);
  }

  function saveNote() {
    const submittedDraft = draft;
    const submittedRevision = savedRevision;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveAction(
          bookingId,
          submittedDraft,
          submittedRevision,
        );
        if (!result.ok) {
          if (result.conflict) {
            setSavedNotes(result.notes ?? "");
            setSavedRevision(result.revision);
            setHasConflict(true);
          }
          focusEditorAfterFailure.current = true;
          setError(result.error);
          return;
        }

        const nextNotes = result.notes ?? "";
        draftStore.clear(draftKey);
        setSavedNotes(nextNotes);
        setSavedRevision(result.revision);
        draftBaseRevisionRef.current = result.revision;
        setDraft(nextNotes);
        setHasConflict(false);
        focusTriggerAfterEdit.current = true;
        setEditing(false);
        setMessage(
          nextNotes ? "Private shoot note saved." : "Private shoot note cleared.",
        );
        refreshAction();
      } catch {
        focusEditorAfterFailure.current = true;
        setError("Could not save the private shoot note.");
      }
    });
  }

  return (
    <section
      data-private-shoot-notes-editor
      className="rounded-2xl border border-realtor-primary/20 bg-realtor-primary/5 p-3"
      aria-labelledby={headingId}
      aria-busy={isPending}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            id={headingId}
            className="text-xs font-semibold uppercase tracking-wider text-realtor-primary"
          >
            Private shoot notes
          </p>
          <p className="mt-0.5 text-xs text-realtor-muted">
            Your reminder only — never shared with the realtor.
          </p>
        </div>
        {!editing ? (
          <button
            ref={triggerRef}
            type="button"
            onClick={beginEditing}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-realtor-primary/20 bg-white px-3 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-realtor-primary/40"
          >
            {savedNotes ? "Edit" : "Add note"}
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-3">
          <label htmlFor={fieldId} className="sr-only">
            Private shoot notes
          </label>
          <textarea
            ref={fieldRef}
            id={fieldId}
            value={draft}
            onChange={(event) => {
              const nextDraft = event.target.value;
              if (
                internalShootNotesLength(nextDraft) <=
                MAX_INTERNAL_SHOOT_NOTES_LENGTH
              ) {
                setDraft(nextDraft);
                setMessage(null);
              }
            }}
            rows={4}
            maxLength={MAX_INTERNAL_SHOOT_NOTES_LENGTH * 2}
            disabled={isPending}
            aria-describedby={`${helpId} ${countId}`}
            autoFocus
            className="admin-input min-h-28 resize-y"
            placeholder="Example: Bring the tall tripod. Lockbox is behind the garage."
          />
          <div className="mt-1 flex items-center justify-between gap-3 text-xs text-realtor-muted">
            <span id={helpId}>Saving an empty note clears it.</span>
            <span id={countId} className="shrink-0 tabular-nums">
              {internalShootNotesLength(draft).toLocaleString()}/{MAX_INTERNAL_SHOOT_NOTES_LENGTH.toLocaleString()}
            </span>
          </div>
          {hasConflict ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-semibold">Latest saved note</p>
              <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {savedNotes || "No private reminder."}
              </p>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={cancelEditing}
              disabled={isPending}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-realtor-primary/20 bg-white px-4 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-realtor-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveNote}
              disabled={isPending || !isDirty}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-realtor-primary px-4 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-realtor-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending
                ? "Saving..."
                : hasConflict
                  ? "Overwrite with my draft"
                  : "Save note"}
            </button>
          </div>
        </div>
      ) : savedNotes ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-realtor-text [overflow-wrap:anywhere]">
          {savedNotes}
        </p>
      ) : (
        <p className="mt-2 text-sm text-realtor-muted">No private reminder yet.</p>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
