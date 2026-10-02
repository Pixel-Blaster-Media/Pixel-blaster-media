import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { loadSource, resultQuery } from "./helpers/source-module.mjs";
import { isCancellable } from "../lib/booking/booking-status.ts";

const settings = { organizationName: "Studio", fromName: "Studio", replyToEmail: "studio@example.invalid", adminNotificationEmail: "admin@example.invalid" };
const payload = { to: "customer@example.invalid", from: "Studio <mail@example.invalid>", replyTo: null, subject: "Rescheduled", html: "<p>New time</p>" };
const booking = {
  id: "booking-a", organization_id: "org-a", lifecycle_version: 3, status: "confirmed",
  scheduled_at: "2090-01-01T15:00:00Z", scheduled_ends_at: "2090-01-01T16:30:00Z",
  properties: { street_address: "1 Main", city: "Hamilton", postal_code: "L1L 1L1" },
  profiles: { email: "customer@example.invalid", full_name: "Customer" },
  suppress_realtor_notifications: false, unit_number: "2", google_calendar_event_id: "calendar-a",
};

function workerHarness({ send = { ok: true, id: "provider-a" }, finish = true, rows, state = "completed", expired = false } = {}) {
  const calls = [], emails = [], selects = [];
  const jobs = rows ?? [{ id: "notice-a", organization_id: "org-a", booking_id: "booking-a", recipient: "realtor", payload, lease_token: "lease-a", lease_expires_at: new Date(Date.now() + (expired ? -1 : 90_000)).toISOString() }];
  const service = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "claim_booking_lifecycle_notices") return { data: jobs, error: null };
      if (name === "finish_booking_lifecycle_notice") return { data: finish, error: null };
      if (name === "change_booking_with_lifecycle_notices") return { data: { notice_ids: ["notice-a"] }, error: null };
      throw new Error(name);
    },
    from(table) { assert.equal(table, "booking_lifecycle_notices"); return resultQuery({ data: [{ id: "notice-a", recipient: "realtor", status: state }], error: null }, selects); },
  };
  const lifecycle = loadSource("lib/booking/lifecycle-notices.ts", {
    "@/lib/supabase/server": { getServiceSupabase: () => service },
    "@/lib/email/resend": { sendEmail: async (args) => { emails.push(args); if (send instanceof Error) throw send; return send; } },
    "@/lib/email/settings": { formatFromAddress: () => payload.from },
  });
  return { module: lifecycle, calls, emails, selects };
}

test("leases and stable provider key preserve the exact request across an ambiguous retry", async () => {
  const h = workerHarness();
  await h.module.dispatchLifecycleNotices({ dispatchNotBefore: "2026-09-30T00:00:00.000Z", organizationId: "org-a", bookingId: "booking-a" });
  await h.module.dispatchLifecycleNotices({ dispatchNotBefore: "2026-09-30T00:00:00.000Z", organizationId: "org-a", bookingId: "booking-a" });
  assert.equal(h.emails.length, 2);
  assert.deepEqual(h.emails[0], h.emails[1]);
  assert.equal(h.emails[0].idempotencyKey, "booking-lifecycle-notice-a");
  assert.equal(h.emails[0].fromAddress, payload.from);
  assert.equal(h.calls[1].args.p_lease_token, "lease-a");
  assert.equal(h.calls[1].args.p_provider_id, "provider-a");
  assert.equal(h.calls[0].args.p_organization_id, "org-a");
  assert.equal(h.calls[0].args.p_limit, 2);
});

for (const [label, send] of [["provider rejection", { ok: false, error: "Resend 503" }], ["unconfigured provider", { ok: true, skipped: true }], ["missing receipt", { ok: true }], ["timeout", new Error("timeout")]]) {
  test(`${label} is not reported as delivered and remains visible for recovery`, async () => {
    const h = workerHarness({ send, state: "retryable" });
    const result = await h.module.deliverChangedBookingNotices({ organizationId: "org-a", bookingId: "booking-a", noticeIds: ["notice-a"] });
    assert.equal(result.realtorNotified, false);
    assert.match(result.warning, /not confirmed/);
    assert.equal(h.calls[1].args.p_provider_id, null);
    assert.ok(h.selects.some(([method, name, value]) => method === "eq" && name === "organization_id" && value === "org-a"));
  });
}

test("provider success without a durable receipt does not claim successful delivery", async () => {
  const h = workerHarness({ finish: false });
  const result = await h.module.dispatchLifecycleNotices({ dispatchNotBefore: "2026-09-30T00:00:00.000Z" });
  assert.equal(result.delivered, 0);
  assert.equal(result.ok, false);
});

test("an expired lease cannot start a provider send", async () => {
  const h = workerHarness({ expired: true });
  await h.module.dispatchLifecycleNotices({ dispatchNotBefore: "2026-09-30T00:00:00.000Z" });
  assert.equal(h.emails.length, 0);
});

function actionsHarness({ row = booking, commit = { ok: true, noticeIds: ["notice-a"] }, calendar = true, delivery = { realtorNotified: false, warning: "Email pending." }, free = true } = {}) {
  const calls = [], queries = [];
  const lifecycle = {
    lifecycleNotice: (recipient, _settings, message) => ({ recipient, payload: message }),
    changeBookingWithNotices: async (args) => { calls.push(["commit", args]); return commit; },
    deliverChangedBookingNotices: async (args) => { calls.push(["delivery", args]); return delivery; },
  };
  const dependencies = {
    "@/lib/booking/availability": { BUSINESS_TZ: "America/Toronto", isSlotAvailable: async (...args) => { calls.push(["availability", ...args]); return free; } },
    "@/lib/booking/booking-status": { isCancellable },
    "@/lib/booking/calendar-event-service": { syncStoredBookingGoogleCalendarEvent: async () => { calls.push(["calendar"]); return { ok: calendar }; } },
    "@/lib/booking/lifecycle-notices": lifecycle,
    "@/lib/email/settings": { getOrganizationEmailSettings: async () => settings },
    "@/lib/notifications/push": { sendPushBestEffort: async () => { calls.push(["push"]); } },
    "@/lib/supabase/server": { getServiceSupabase: () => ({ from: () => resultQuery({ data: row, error: null }, queries) }) },
    "@/lib/booking/manage-token": { verifyManageToken: (token) => token === "signed" ? booking.id : null },
    "next/cache": { revalidatePath() {} },
  };
  const cancel = loadSource("lib/booking/cancel.ts", dependencies).cancelBooking;
  dependencies["@/lib/booking/cancel"] = { cancelBooking: cancel };
  const manage = loadSource("app/book/manage/[token]/actions.ts", dependencies);
  return { cancel, manage, calls, queries };
}

test("failed atomic mutation performs no calendar, push or email work", async () => {
  for (const method of ["cancel", "reschedule"]) {
    const h = actionsHarness({ commit: { ok: false, code: "PB004" } });
    const result = method === "cancel" ? await h.cancel(booking.id, "admin", { organizationId: "org-a" }) : await h.manage.rescheduleManagedBooking("signed", "2090-01-02T15:00:00Z");
    assert.equal(result.ok, false);
    assert.equal(h.calls.some(([kind]) => ["calendar", "delivery", "push"].includes(kind)), false);
    assert.equal(h.calls.find(([kind]) => kind === "commit")[1].expectedVersion, 3);
  }
});

test("admin and portal cancellation preserve recipient direction and tenant-scoped compare-and-swap", async () => {
  for (const [initiator, recipient] of [["admin", "realtor"], ["realtor", "admin"]]) {
    const h = actionsHarness();
    const result = await h.cancel(booking.id, initiator, { organizationId: "org-a" });
    assert.equal(result.ok, true); assert.match(result.warning, /Email pending/);
    const mutation = h.calls.find(([kind]) => kind === "commit")[1];
    assert.equal(mutation.organizationId, "org-a");
    assert.deepEqual(Array.from(mutation.notices, (x) => x.recipient), [recipient]);
    assert.match(mutation.notices[0].payload.subject, /Unit 2/);
    assert.ok(h.queries.some(([method, column, value]) => method === "eq" && column === "organization_id" && value === "org-a"));
  }
});

test("managed cancellation queues both notices together and retains Calendar plus delivery warnings", async () => {
  const h = actionsHarness({ calendar: false });
  const result = await h.manage.cancelManagedBooking("signed");
  assert.equal(result.ok, true);
  assert.match(result.warning, /Calendar/); assert.match(result.warning, /Email pending/);
  assert.deepEqual(Array.from(h.calls.find(([kind]) => kind === "commit")[1].notices, (x) => x.recipient), ["realtor", "admin"]);
});

test("quiet bookings suppress every customer lifecycle notice but retain studio notices", async () => {
  for (const kind of ["admin", "managed-cancel", "reschedule"]) {
    const h = actionsHarness({ row: { ...booking, suppress_realtor_notifications: true } });
    if (kind === "admin") await h.cancel(booking.id, "admin", { organizationId: "org-a" });
    else if (kind === "managed-cancel") await h.manage.cancelManagedBooking("signed");
    else await h.manage.rescheduleManagedBooking("signed", "2090-01-02T15:00:00Z");
    const notices = h.calls.find(([event]) => event === "commit")[1].notices;
    assert.deepEqual(Array.from(notices, (n) => n.recipient), kind === "admin" ? [] : ["admin"]);
  }
});

test("reschedule preserves duration, validates availability, excludes itself and rejects unsigned requests", async () => {
  const h = actionsHarness();
  assert.equal((await h.manage.rescheduleManagedBooking("unsigned", "2090-01-02T15:00:00Z")).ok, false);
  assert.equal(h.calls.length, 0);
  await h.manage.rescheduleManagedBooking("signed", "2090-01-02T15:00:00Z");
  const mutation = h.calls.find(([kind]) => kind === "commit")[1];
  assert.equal(mutation.scheduledEndsAt, "2090-01-02T16:30:00.000Z");
  assert.equal(h.calls[0][3].excludeBookingId, booking.id);
  const unavailable = actionsHarness({ free: false });
  assert.equal((await unavailable.manage.rescheduleManagedBooking("signed", "2090-01-02T15:00:00Z")).ok, false);
  assert.equal(unavailable.calls.some(([kind]) => kind === "commit"), false);
});

test("admin notice status is tenant-scoped, private and honest about provider acceptance", async () => {
  const calls = [];
  const require = createRequire(import.meta.url);
  const Component = loadSource("app/admin/bookings/[id]/LifecycleNotices.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/lib/auth/require-admin": { requireAdmin: async () => ({ organizationId: "org-a" }) },
    "@/lib/supabase/server": { getServiceSupabase: () => ({ from(table) {
      assert.equal(table, "booking_lifecycle_notices");
      return resultQuery({ data: [
        { id: "a", event: "rescheduled", recipient: "realtor", status: "completed" },
        { id: "b", event: "cancelled", recipient: "admin", status: "dead_letter" },
      ], error: null }, calls);
    } }) },
  }).default;
  const html = renderToStaticMarkup(await Component({ bookingId: "booking-a" }));
  assert.ok(calls.some(([method,key,value]) => method === "eq" && key === "organization_id" && value === "org-a"));
  assert.ok(calls.some(([method,key,value]) => method === "eq" && key === "booking_id" && value === "booking-a"));
  assert.equal(calls.find(([method]) => method === "select")[1].includes("payload"), false);
  assert.match(html, /Accepted by email provider/);
  assert.match(html, /Delivery unconfirmed/);
  assert.match(html, /Check the email provider for a receipt/);
});
