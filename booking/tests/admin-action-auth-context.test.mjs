import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const [
  assistantSource,
  requireAdminSource,
  contextSource,
  calendarActionsSource,
  bookingActionsSource,
] = await Promise.all([
  read("app/admin/assistant/actions.ts"),
  read("lib/auth/require-admin.ts"),
  read("lib/auth/admin-action-context.ts"),
  read("app/admin/calendar/actions.ts"),
  read("app/admin/bookings/[id]/actions.ts"),
]);

function runProductionContextFixture() {
  const hook = fileURLToPath(
    new URL("./fixtures/server-only-cjs-hook.mjs", import.meta.url),
  );
  const fixture = fileURLToPath(
    new URL("./fixtures/admin-action-context-runtime.mts", import.meta.url),
  );
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--import", hook, fixture],
    { cwd: root, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } },
  );
  return JSON.parse(output);
}

const runtimeResult = runProductionContextFixture();

test("the production wrapper and guard reuse one isolated verified Admin context", () => {
  const result = runtimeResult;
  assert.equal(result.outsideBefore, null);
  assert.equal(result.inheritedGuardUserId, "admin-a");
  assert.deepEqual(result.concurrent, ["admin-a", "admin-b"]);
  assert.equal(result.outsideAfter, null);
  assert.deepEqual(result.directActionRejections, {
    create: true,
    update: true,
    delivery: true,
  });
});

test("the verified Admin authority is a frozen server-owned snapshot", () => {
  assert.deepEqual(runtimeResult.immutableContext, {
    sameObject: false,
    frozen: true,
    mutationRejected: true,
    userId: "immutable-admin",
    organizationId: "immutable-org",
  });
});

test("verified context is invalidated before detached work runs after settlement", () => {
  const result = runtimeResult;
  assert.equal(result.detachedAfterSettlement, null);
});

test("the complete confirmed assistant call graph is wrapped after authentication", () => {
  const confirmStart = assistantSource.indexOf(
    "export async function confirmAdminAssistantAction",
  );
  const confirmEnd = assistantSource.indexOf(
    "export async function getAssistantActionLogs",
    confirmStart,
  );
  const confirmBody = assistantSource.slice(confirmStart, confirmEnd);

  assert.match(
    assistantSource,
    /import \{ runWithVerifiedAdminActionContext \} from "@\/lib\/auth\/admin-action-context";/,
  );
  assert.match(
    confirmBody,
    /const admin = await requireAdmin\(\);[\s\S]*return runWithVerifiedAdminActionContext\(admin, async \(\) => \{[\s\S]*executeConfirmedAssistantAction\(admin, action\)[\s\S]*recordAssistantAction\(admin, action, result\)[\s\S]*return result;[\s\S]*\}\);/,
  );
});

test("only the server-owned context can bypass repeated nested guards", () => {
  assert.match(contextSource, /^import "server-only";/);
  assert.doesNotMatch(contextSource, /^"use server";/m);
  assert.match(
    requireAdminSource,
    /const inherited = getVerifiedAdminActionContext\(\);\s*if \(inherited\) return inherited;/,
  );

  const createBoundary = calendarActionsSource.slice(
    calendarActionsSource.indexOf("export async function createAdminShoot"),
    calendarActionsSource.indexOf("export async function rescheduleCalendarShoot"),
  );
  const bookingGuard = bookingActionsSource.slice(
    bookingActionsSource.indexOf("async function requireAdminForBooking"),
    bookingActionsSource.indexOf("export async function updateBookingStatus"),
  );
  assert.match(createBoundary, /const admin = await requireAdmin\(\);/);
  assert.match(bookingGuard, /const admin = await requireAdmin\(\);/);
  assert.match(bookingActionsSource, /updateBookingStatus[\s\S]*requireAdminForBooking\(bookingId\)/);
  assert.match(bookingActionsSource, /sendDeliveryReadyEmail[\s\S]*requireAdminForBooking\(bookingId\)/);
});
