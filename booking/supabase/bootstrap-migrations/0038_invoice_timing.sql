-- ============================================================================
-- Pixel Blaster Booking — Phase 38: invoice timing setting
-- ----------------------------------------------------------------------------
-- The photographer bills after a job is delivered, so the QuickBooks payment
-- link is emailed automatically with the "media ready" email by default.
-- Some companies prefer collecting up front, so the timing can be switched to
-- "at booking" — the invoice is then created when the public booking lands
-- and the payment link rides along in the confirmation email.
--
-- Billing stays best-effort everywhere: if QuickBooks is not connected or
-- invoice creation fails, booking and delivery emails go out unchanged.
-- ============================================================================

alter table public.organizations
  add column if not exists invoice_timing text not null default 'on_delivery'
    check (invoice_timing in ('on_delivery', 'at_booking'));

comment on column public.organizations.invoice_timing is
  'When the QuickBooks invoice payment link is emailed automatically: after media delivery (default) or as soon as the booking is made.';
