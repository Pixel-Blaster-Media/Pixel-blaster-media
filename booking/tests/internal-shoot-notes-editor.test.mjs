import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

async function loadCore() {
  try {
    const importedModule = await tsImport(
      "../lib/booking/internal-shoot-notes-core.ts",
      import.meta.url,
    );
    return importedModule.default;
  } catch {
    return null;
  }
}

test("private shoot notes trim surrounding whitespace while preserving the reminder", async () => {
  const core = await loadCore();
  assert.ok(core, "the private shoot-notes behavior module must exist");
  assert.deepEqual(core.normalizeInternalShootNotes("  Bring the tall tripod.  \n"), {
    ok: true,
    notes: "Bring the tall tripod.",
  });
});

test("an empty private shoot note clears the reminder", async () => {
  const core = await loadCore();
  assert.ok(core);
  assert.deepEqual(core.normalizeInternalShootNotes(" \n\t "), {
    ok: true,
    notes: null,
  });
});

test("private shoot notes reject reminders longer than 2,000 characters", async () => {
  const core = await loadCore();
  assert.ok(core);
  assert.deepEqual(core.normalizeInternalShootNotes("x".repeat(2_001)), {
    ok: false,
    error: "Private shoot notes must be 2,000 characters or fewer.",
  });
});

test("private shoot notes count Unicode code points like PostgreSQL", async () => {
  const core = await loadCore();
  assert.ok(core);
  assert.deepEqual(core.normalizeInternalShootNotes("😀".repeat(2_000)), {
    ok: true,
    notes: "😀".repeat(2_000),
  });
  assert.deepEqual(core.normalizeInternalShootNotes("😀".repeat(2_001)), {
    ok: false,
    error: "Private shoot notes must be 2,000 characters or fewer.",
  });
});

test("private shoot notes reject non-text form values", async () => {
  const core = await loadCore();
  assert.ok(core);
  assert.deepEqual(core.normalizeInternalShootNotes({ name: "attachment.txt" }), {
    ok: false,
    error: "Enter a valid private shoot note.",
  });
});

test("saving a private shoot note targets only the exact organization and booking", async () => {
  const core = await loadCore();
  assert.ok(core);
  const writes = [];
  const result = await core.updateInternalShootNotes({
    organizationId: "org-1",
    bookingId: "booking-1",
    actorId: "admin-1",
    expectedRevision: 7,
    value: "  Park in the laneway.  ",
    store: {
      async updateInternalNotes(input) {
        writes.push(input);
        return { status: "saved", notes: input.notes, revision: 8 };
      },
    },
  });

  assert.deepEqual(writes, [
    {
      organizationId: "org-1",
      bookingId: "booking-1",
      actorId: "admin-1",
      expectedRevision: 7,
      notes: "Park in the laneway.",
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    notes: "Park in the laneway.",
    revision: 8,
  });
});

test("a booking outside the authenticated organization is reported as not found", async () => {
  const core = await loadCore();
  assert.ok(core);
  const result = await core.updateInternalShootNotes({
    organizationId: "org-1",
    bookingId: "other-tenant-booking",
    actorId: "admin-1",
    expectedRevision: 0,
    value: "Do not expose this write.",
    store: {
      async updateInternalNotes() {
        return { status: "not_found" };
      },
    },
  });

  assert.deepEqual(result, { ok: false, error: "Booking not found." });
});

test("a failed note write returns a controlled error instead of false success", async () => {
  const core = await loadCore();
  assert.ok(core);
  const result = await core.updateInternalShootNotes({
    organizationId: "org-1",
    bookingId: "booking-1",
    actorId: "admin-1",
    expectedRevision: 3,
    value: "Use the side entrance.",
    store: {
      async updateInternalNotes() {
        return { status: "error" };
      },
    },
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Could not save the private shoot note.",
  });
});

test("the server action authorizes and updates only the scoped internal-notes field", async () => {
  const actionSource = await readFile(
    new URL(
      "../app/admin/internal-shoot-notes/actions.ts",
      import.meta.url,
    ),
    "utf8",
  ).catch(() => "");

  assert.match(actionSource, /export async function saveInternalShootNotes/);
  const authIndex = actionSource.indexOf("await requireAdmin()");
  const mutationIndex = actionSource.indexOf("await updateBookingInternalNotes(");
  assert.ok(authIndex >= 0 && mutationIndex > authIndex);
  assert.match(actionSource, /actorId:\s*admin\.userId/);
  assert.match(actionSource, /expectedRevision/);
  assert.doesNotMatch(actionSource, /\.from\("bookings"\)|internal_notes:\s*notes/);
  assert.doesNotMatch(actionSource, /client_notes|sendEmail|syncGoogle|createEvent/);
  for (const path of [
    "/admin/today",
    "/admin/calendar",
    "/admin/bookings",
  ]) {
    assert.match(actionSource, new RegExp(`revalidatePath\\(\\"${path}`));
  }
});

test("Today and booking details place the editable private note in the existing notes areas", async () => {
  const [todaySource, detailSource, wrapperSource, editorSource] = await Promise.all([
    readFile(new URL("../app/admin/today/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/admin/bookings/[id]/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/admin/internal-shoot-notes/InternalShootNotesEditor.tsx",
        import.meta.url,
      ),
      "utf8",
    ).catch(() => ""),
    readFile(
      new URL(
        "../app/admin/internal-shoot-notes/InternalShootNotesEditorView.tsx",
        import.meta.url,
      ),
      "utf8",
    ).catch(() => ""),
  ]);

  assert.match(todaySource, /<InternalShootNotesEditor[\s\S]*bookingId=\{booking\.id\}[\s\S]*initialNotes=\{privateShootNotes\.notes\}[\s\S]*initialRevision=\{privateShootNotes\.revision\}/);
  assert.match(detailSource, /<Panel title="Notes">[\s\S]*<InternalShootNotesEditor[\s\S]*bookingId=\{booking\.id\}[\s\S]*initialNotes=\{privateShootNotes\.notes\}[\s\S]*initialRevision=\{privateShootNotes\.revision\}/);
  assert.match(wrapperSource, /saveAction=\{saveInternalShootNotes\}/);
  assert.match(editorSource, /Private shoot notes/);
  assert.match(editorSource, /saveAction\([\s\S]*bookingId,[\s\S]*submittedDraft,[\s\S]*submittedRevision/);
  assert.match(editorSource, /maxLength=\{MAX_INTERNAL_SHOOT_NOTES_LENGTH \* 2\}/);
  assert.match(editorSource, /internalShootNotesLength\(nextDraft\)/);
  assert.match(
    editorSource,
    /<textarea\b(?:(?!\/>)[\s\S])*disabled=\{isPending\}(?:(?!\/>)[\s\S])*\/>/,
  );
  assert.match(editorSource, /Save note/);
  assert.match(editorSource, /Cancel/);
  assert.match(editorSource, /min-h-11/);
  assert.match(editorSource, /role="alert"/);
  assert.match(editorSource, /role="status"/);
});

test("the focused editor cannot be reset or later overwritten by the full booking form", async () => {
  const [editorSource, formSource, detailSource, bookingActionsSource] =
    await Promise.all([
      readFile(
        new URL(
          "../app/admin/internal-shoot-notes/InternalShootNotesEditorView.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/admin/bookings/[id]/EditBookingForm.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../app/admin/bookings/[id]/page.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/admin/bookings/[id]/actions.ts", import.meta.url),
        "utf8",
      ),
    ]);

  assert.doesNotMatch(editorSource, /\[editing,\s*initialNotes\]/);
  assert.doesNotMatch(formSource, /name="internal_notes"|internalNotes:/);
  assert.match(
    detailSource,
    /<InternalShootNotesEditor[\s\S]*key=\{booking\.id\}[\s\S]*bookingId=\{booking\.id\}/,
  );

  const editStart = bookingActionsSource.indexOf(
    "export async function updateBookingDetails",
  );
  const editEnd = bookingActionsSource.indexOf(
    "export async function updateBookingServicesFromCalendar",
    editStart,
  );
  assert.ok(editStart >= 0 && editEnd > editStart);
  assert.doesNotMatch(
    bookingActionsSource.slice(editStart, editEnd),
    /internal_notes/,
  );
});
