import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260718202432_atomic_public_booking_outbox.sql",
  import.meta.url,
);
const setupSource = readFileSync(
  new URL("../supabase/setup.sql", import.meta.url),
  "utf8",
);
const bookingActionSource = readFileSync(
  new URL("../app/book/actions.ts", import.meta.url),
  "utf8",
);

const confirmPageSource = readFileSync(
  new URL("../app/book/confirm/page.tsx", import.meta.url),
  "utf8",
);
const confirmFormSource = readFileSync(
  new URL("../app/book/confirm/ConfirmForm.tsx", import.meta.url),
  "utf8",
);
const emailSource = readFileSync(
  new URL("../lib/email/resend.ts", import.meta.url),
  "utf8",
);
const quickBooksInvoiceSource = readFileSync(
  new URL("../lib/integrations/quickbooks/invoice.ts", import.meta.url),
  "utf8",
);
const integrationJobsUrl = new URL(
  "../lib/integrations/jobs.ts",
  import.meta.url,
);
const dispatcherSource = readFileSync(
  new URL("../lib/integrations/dispatcher.ts", import.meta.url),
  "utf8",
);
const postgresBehaviorUrl = new URL(
  "./postgres/atomic-booking-outbox.behavior.sql",
  import.meta.url,
);
const postgresRunnerUrl = new URL(
  "../scripts/verify-atomic-booking-postgres.sh",
  import.meta.url,
);

test("public booking aggregate is committed through one service-role-only RPC", () => {
  assert.equal(existsSync(migrationUrl), true, "missing atomic booking migration");
  assert.equal(existsSync(postgresBehaviorUrl), true, "missing PostgreSQL behavior suite");
  assert.equal(existsSync(postgresRunnerUrl), true, "missing disposable PostgreSQL runner");
  const postgresBehavior = readFileSync(postgresBehaviorUrl, "utf8");
  assert.match(postgresBehavior, /catalog identity update should fail/);
  assert.match(postgresBehavior, /forced line failure left aggregate residue/);
  assert.match(postgresBehavior, /email was reclaimed outside provider idempotency window/);
  assert.match(postgresBehavior, /durable provider payload is incomplete/);
  assert.match(postgresBehavior, /integration payload update should fail/);
  assert.match(postgresBehavior, /incomplete integration payload insert should fail/);
  assert.match(postgresBehavior, /complete-shaped invalid integration payload should fail/);
  assert.match(postgresBehavior, /unsupported integration job type should fail/);
  assert.match(postgresBehavior, /unsupported integration payload version should fail/);
  assert.match(postgresBehavior, /provider payload did not preserve selection order/);
  assert.match(postgresBehavior, /retryable email bypassed provider idempotency cutoff/);
  assert.match(postgresBehavior, /customer email claimed before invoice started/);
  assert.match(postgresBehavior, /customer email claimed while invoice was leased/);
  assert.match(postgresBehavior, /customer email claim did not carry completed invoice result/);
  assert.match(
    setupSource,
    /End supabase\/migrations\/20260718202432_atomic_public_booking_outbox\.sql/,
  );
  const sql = readFileSync(migrationUrl, "utf8");

  assert.match(sql, /create or replace function public\.create_public_booking_with_jobs/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path\s*=\s*''/i);
  assert.match(sql, /p\.role\s*=\s*'realtor'/i);
  assert.match(sql, /p\.archived_at\s+is\s+null/i);
  assert.match(sql, /om\.role\s*=\s*'member'/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /insert into public\.properties/i);
  assert.match(sql, /insert into public\.bookings/i);
  assert.match(sql, /p_service_item_ids uuid\[\]/i);
  assert.match(sql, /p_add_on_item_ids uuid\[\]/i);
  assert.doesNotMatch(sql, /p_line_items jsonb/i);
  assert.match(sql, /catalog\.organization_id = p_organization_id/i);
  assert.match(sql, /catalog\.active = true/i);
  assert.match(sql, /catalog\.sqft_pricing_enabled/i);
  assert.match(sql, /catalog\.overage_increment_sqft/i);
  assert.match(sql, /insert into public\.booking_line_items/i);
  assert.match(sql, /item_name[\s\S]*item_slug[\s\S]*item_kind/i);
  assert.match(sql, /snapshot_booking_line_item_identity_trigger/i);
  assert.match(sql, /catalog_item_id is distinct from old\.catalog_item_id[\s\S]*errcode = '23514'/i);
  assert.match(sql, /new\.unit_price_cents := old\.unit_price_cents/i);
  assert.match(sql, /public_request_fingerprint/i);
  assert.match(sql, /public-booking-request:[\s\S]*select b\.id[\s\S]*if has_existing_booking then[\s\S]*catalog\.active = true/i);
  assert.match(sql, /create table public\.integration_jobs/i);
  assert.match(sql, /create or replace function public\.is_valid_booking_integration_payload/i);
  assert.match(sql, /payload[\s\S]*public\.is_valid_booking_integration_payload\([\s\S]*organization_id[\s\S]*booking_id/i);
  assert.match(sql, /payload_version[\s\S]*check \(payload_version = 1\)/i);
  assert.match(sql, /jsonb_array_length\(p_payload->'line_items'\) = 0/i);
  assert.doesNotMatch(sql, /payload\s+jsonb not null default '\{\}'::jsonb/i);
  assert.match(sql, /preserve_integration_job_identity[\s\S]*new\.payload is distinct from old\.payload/i);
  assert.match(sql, /'line_items'[\s\S]*jsonb_agg[\s\S]*job_payload/i);
  assert.match(sql, /add column if not exists public_request_id uuid/i);
  assert.match(sql, /create unique index[\s\S]*\(organization_id, public_request_id\)[\s\S]*where public_request_id is not null/i);
  assert.match(sql, /insert into public\.integration_jobs/i);
  for (const jobType of [
    "quickbooks.invoice.create",
    "google_calendar.event.create",
    "email.booking.confirmation",
    "email.admin.new_booking",
    "push.admin.new_booking",
  ]) {
    assert.match(sql, new RegExp(jobType.replaceAll(".", "\\.")));
  }
  assert.match(sql, /alter table public\.integration_jobs enable row level security/i);
  assert.match(sql, /revoke all on table public\.integration_jobs from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.integration_jobs to service_role/i);
  assert.match(sql, /foreign key \(organization_id, booking_id\)/i);
  assert.match(sql, /lease_token\s+uuid/i);
  assert.match(sql, /lease_expires_at\s+timestamptz/i);
  assert.match(sql, /create or replace function public\.claim_integration_job/i);
  assert.match(sql, /job\.status = 'processing'[\s\S]*job\.lease_expires_at <= pg_catalog\.now\(\)/i);
  assert.match(sql, /email\.booking\.confirmation[\s\S]*email\.admin\.new_booking/i);
  assert.match(sql, /created_at > pg_catalog\.now\(\) - interval '23 hours'/i);
  assert.match(sql, /created_at <= pg_catalog\.now\(\) - interval '23 hours'/i);
  assert.match(sql, /provider_idempotency_window_expired/i);
  assert.match(sql, /status = 'retryable'[\s\S]*created_at > pg_catalog\.now\(\) - interval '23 hours'/i);
  assert.match(sql, /array_position\(p_service_item_ids, line\.catalog_item_id\)/i);
  assert.match(sql, /email\.booking\.confirmation[\s\S]*invoice_job\.job_type = 'quickbooks\.invoice\.create'[\s\S]*status not in \('completed', 'skipped', 'cancelled', 'dead_letter'\)/i);
  assert.match(sql, /job\.attempts < job\.max_attempts/i);
  assert.match(sql, /create or replace function public\.finish_integration_job/i);
  assert.match(sql, /final_status[\s\S]*current_attempts >= current_max_attempts/i);
  assert.match(sql, /lease_expires_at > pg_catalog\.now\(\)/i);
  assert.match(
    sql,
    /revoke all on function public\.create_public_booking_with_jobs[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.create_public_booking_with_jobs[\s\S]*to service_role/i,
  );

  assert.match(bookingActionSource, /\.rpc\(\s*"create_public_booking_with_jobs"/);
  assert.match(
    bookingActionSource,
    /\.eq\("public_request_id", publicRequestId\)[\s\S]*if \(!existingRequest\)[\s\S]*isSlotAvailable/,
  );
  assert.ok(
    bookingActionSource.indexOf('.eq("public_request_id", publicRequestId)') <
      bookingActionSource.indexOf("isSlotAvailable(slotStart"),
  );
  assert.match(bookingActionSource, /bookErr\?\.code === "PB002"/);
  assert.match(bookingActionSource, /Packages changed while you were booking/);
  assert.match(bookingActionSource, /bookErr\?\.code === "PB004"/);
  assert.match(bookingActionSource, /confirmation was already used with different details/);

  assert.doesNotMatch(bookingActionSource, /\.from\("properties"\)[\s\S]{0,500}\.insert\(/);
  assert.doesNotMatch(bookingActionSource, /\.from\("bookings"\)[\s\S]{0,500}\.insert\(/);
  assert.doesNotMatch(bookingActionSource, /\.from\("booking_line_items"\)[\s\S]{0,500}\.insert\(/);
});

test("inline and scheduled integration attempts share the durable dispatcher", () => {
  assert.match(confirmPageSource, /requestId=\{randomUUID\(\)\}/);
  assert.match(confirmFormSource, /name="public_request_id"\s+value=\{requestId\}/);

  assert.equal(existsSync(integrationJobsUrl), true, "missing integration job helper");
  const jobsSource = readFileSync(integrationJobsUrl, "utf8");
  assert.match(jobsSource, /export async function claimIntegrationJob/);
  assert.match(jobsSource, /export async function finishIntegrationJob/);
  assert.match(jobsSource, /\.rpc\("claim_integration_job"/);
  assert.match(jobsSource, /\.rpc\("finish_integration_job"/);
  assert.match(
    jobsSource,
    /status === "retryable"[\s\S]*claim\.attempts >= claim\.maxAttempts[\s\S]*"dead_letter"/,
  );
  assert.doesNotMatch(jobsSource, /\.from\("integration_jobs"\)/);
  assert.match(jobsSource, /parseBookingIntegrationPayload/);
  assert.match(jobsSource, /row\.organization_id !== organizationId/);
  assert.match(jobsSource, /row\.booking_id !== bookingId/);
  assert.match(jobsSource, /row\.job_type !== jobType/);
  assert.match(jobsSource, /row\.payload_version !== 1/);
  assert.match(jobsSource, /payload\.organization_id !== organizationId/);
  assert.match(jobsSource, /payload\.booking_id !== bookingId/);

  assert.match(bookingActionSource, /dispatchBookingIntegrationJobs\(/);
  assert.match(
    bookingActionSource,
    /buildIntegrationWorkerId\(\s*"inline-public-booking"/,
  );
  assert.doesNotMatch(bookingActionSource, /createInvoiceForBooking\(/);
  assert.doesNotMatch(bookingActionSource, /getGoogleCalendarClient\(/);
  assert.doesNotMatch(bookingActionSource, /sendPushBestEffort\(/);

  assert.match(dispatcherSource, /const payload = claim\.payload/g);
  assert.match(dispatcherSource, /lineItems:\s*payload\.line_items/);
  assert.match(
    dispatcherSource,
    /getGoogleCalendarClient\([\s\S]{0,120}payload\.organization_id/,
  );
  assert.match(dispatcherSource, /payload\.organization\.admin_notification_email/);
  assert.match(dispatcherSource, /sendPushBestEffort\(payload\.organization_id/);
  assert.match(dispatcherSource, /claim\.dependencyResult[\s\S]*invoiceUrl/);
  assert.match(dispatcherSource, /invoiceUrl[\s\S]*pay your invoice online/);
  assert.match(dispatcherSource, /finishIntegrationJob\(/);
  assert.match(dispatcherSource, /outcome:\s*"settlement_failed"/);

  for (const jobType of [
    "quickbooks.invoice.create",
    "google_calendar.event.create",
    "email.booking.confirmation",
    "email.admin.new_booking",
    "push.admin.new_booking",
  ]) {
    assert.match(dispatcherSource, new RegExp(jobType.replaceAll(".", "\\.")));
  }

  assert.match(emailSource, /idempotencyKey\?: string/);
  assert.match(emailSource, /"Idempotency-Key": args\.idempotencyKey/);
  assert.match(
    emailSource,
    /args\.replyTo === undefined[\s\S]*settings\.replyToEmail[\s\S]*args\.replyTo \?\? undefined/,
  );
  assert.match(dispatcherSource, /replyTo:\s*payload\.organization\.reply_to_email/);
  assert.match(
    dispatcherSource,
    /status:\s*"dead_letter"[\s\S]*ambiguous_provider_result/,
  );
  assert.ok(
    (dispatcherSource.match(/idempotencyKey:\s*claim\.idempotencyKey/g) ?? []).length >= 2,
    "both email jobs must use the durable provider key",
  );
  assert.match(
    quickBooksInvoiceSource,
    /\.select\("quantity, unit_price_cents, item_name"\)/,
  );
  assert.match(quickBooksInvoiceSource, /description: line\.item_name/);
  assert.doesNotMatch(quickBooksInvoiceSource, /catalog_items\(name\)/);
  assert.match(
    bookingActionSource,
    /Your booking was saved, but confirmation could not finish/,
  );
});
