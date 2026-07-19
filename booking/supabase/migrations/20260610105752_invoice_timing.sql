-- Phase 38: invoice timing setting. Adds organizations.invoice_timing
-- ('on_delivery' default | 'at_booking') controlling when the QuickBooks
-- payment link is emailed automatically.
alter table public.organizations
  add column if not exists invoice_timing text not null default 'on_delivery'
    check (invoice_timing in ('on_delivery', 'at_booking'));

comment on column public.organizations.invoice_timing is
  'When the QuickBooks invoice payment link is emailed automatically: after media delivery (default) or as soon as the booking is made.';;
