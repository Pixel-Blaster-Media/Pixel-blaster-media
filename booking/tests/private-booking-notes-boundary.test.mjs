import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("private booking notes use the service-only table and revisioned RPC", async () => {
  const [serverBoundary, focusedAction, setup, packageJson] = await Promise.all([
    source("lib/booking/internal-shoot-notes-server.ts").catch(() => ""),
    source("app/admin/internal-shoot-notes/actions.ts"),
    source("supabase/setup.sql"),
    source("package.json"),
  ]);

  assert.match(serverBoundary, /rpc\(\s*"get_booking_internal_notes"/);
  assert.match(serverBoundary, /rpc\(\s*"update_booking_internal_notes"/);
  assert.doesNotMatch(serverBoundary, /from\("booking_internal_notes"\)/);
  assert.match(serverBoundary, /expectedRevision/);
  assert.doesNotMatch(focusedAction, /\.from\("bookings"\)[\s\S]*\.update\(\{ internal_notes:/);
  assert.match(focusedAction, /expectedRevision/);
  assert.match(setup, /create table public\.booking_internal_notes/);
  assert.match(setup, /bookings_internal_notes_must_be_null/);
  assert.match(setup, /update_booking_internal_notes/);
  assert.match(packageJson, /verify:postgres:private-notes/);
});

test("all booking-note readers and writers leave the realtor-readable bookings column", async () => {
  const files = [
    "app/admin/today/page.tsx",
    "app/admin/today/actions.ts",
    "app/admin/calendar/page.tsx",
    "app/admin/bookings/[id]/page.tsx",
    "app/admin/assistant/actions.ts",
    "app/admin/internal-shoot-notes/actions.ts",
  ];
  const entries = await Promise.all(files.map(async (file) => [file, await source(file)]));

  for (const [file, text] of entries) {
    assert.doesNotMatch(
      text,
      /client_notes,\s*internal_notes|\.from\("bookings"\)\s*\.select\(\s*["']id,\s*internal_notes["']\s*\)/,
      `${file} still reads bookings.internal_notes`,
    );
    assert.doesNotMatch(
      text,
      /\.from\("bookings"\)[\s\S]{0,300}\.update\(\{\s*internal_notes:/,
      `${file} still writes bookings.internal_notes directly`,
    );
  }
});

test("assistant booking-note writes share normalization and optimistic revision conflict handling", async () => {
  const [assistant, core, serverBoundary] = await Promise.all([
    source("app/admin/assistant/actions.ts"),
    source("lib/booking/internal-shoot-notes-core.ts"),
    source("lib/booking/internal-shoot-notes-server.ts").catch(() => ""),
  ]);

  assert.match(assistant, /updateBookingInternalNotes/);
  assert.match(assistant, /expectedRevision/);
  assert.doesNotMatch(assistant, /appendNote\(booking\.internal_notes/);
  assert.match(core, /MAX_INTERNAL_SHOOT_NOTES_LENGTH/);
  assert.match(serverBoundary, /updateInternalShootNotes\(\{/);
  assert.match(serverBoundary, /status === "conflict"/);
});

test("assistant note apply and undo refresh every note surface without falsely completing failed undo", async () => {
  const assistant = await source("app/admin/assistant/actions.ts");
  const applyStart = assistant.indexOf('if (action.type === "update_booking_note")');
  const applyEnd = assistant.indexOf('if (action.type === "update_business_hours")', applyStart);
  const applyBlock = assistant.slice(applyStart, applyEnd);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  for (const path of ["/admin/bookings", "/admin/today", "/admin/calendar"]) {
    assert.match(applyBlock, new RegExp(`revalidatePath\\(\\"${path}`));
  }
  assert.match(applyBlock, /revalidatePath\(`\/admin\/bookings\/\$\{action\.bookingId\}`\)/);

  const undoStart = assistant.indexOf("async function applyAssistantUndo(");
  const undoEnd = assistant.indexOf("async function recordAssistantAction(", undoStart);
  const undoBlock = assistant.slice(undoStart, undoEnd);
  assert.match(undoBlock, /target_booking_id/);
  assert.match(undoBlock, /revalidatePath\(`\/admin\/bookings\/\$\{log\.target_booking_id\}`\)/);
  const failedUndoStart = undoBlock.indexOf("if (!undoResult.ok)");
  const successfulUndoStart = undoBlock.indexOf("await markAssistantUndo", failedUndoStart);
  const failedUndoBlock = undoBlock.slice(failedUndoStart, successfulUndoStart);
  assert.match(failedUndoBlock, /recordAssistantUndoFailure/);
  assert.doesNotMatch(failedUndoBlock, /markAssistantUndo/);

  const failureRecorderStart = assistant.indexOf("async function recordAssistantUndoFailure(");
  const failureRecorderEnd = assistant.indexOf("async function markAssistantUndo(", failureRecorderStart);
  const failureRecorder = assistant.slice(failureRecorderStart, failureRecorderEnd);
  assert.ok(failureRecorderStart >= 0 && failureRecorderEnd > failureRecorderStart);
  const failureUpdate = failureRecorder.match(/\.update\((\{[^)]*\})\)/s)?.[1] ?? "";
  assert.match(failureUpdate, /undo_result_message/);
  assert.doesNotMatch(failureUpdate, /undone_at|undone_by/);
  assert.match(failureRecorder, /\.is\(\"undone_at\", null\)/);
});
