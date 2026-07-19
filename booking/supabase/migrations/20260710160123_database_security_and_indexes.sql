-- Security-advisor cleanup for helper functions. Every referenced relation is
-- schema-qualified, so an empty search_path removes object-shadowing risk.
alter function public.set_updated_at() set search_path = '';
alter function public.handle_new_auth_user() set search_path = '';
alter function public.is_admin() set search_path = '';
alter function public.current_organization_id() set search_path = '';
alter function public.is_organization_admin(uuid) set search_path = '';
alter function public.create_booking_from_request(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
) set search_path = '';

-- The old exclusion constraint installed btree_gist in the public API schema.
-- Keep the extension available, but move its objects out of the exposed schema.
create schema if not exists extensions;
do $$
declare
  extension_schema name;
begin
  select ns.nspname
    into extension_schema
    from pg_catalog.pg_extension ext
    join pg_catalog.pg_namespace ns
      on ns.oid = ext.extnamespace
    where ext.extname = 'btree_gist';

  if extension_schema is not null and extension_schema <> 'extensions' then
    alter extension btree_gist set schema extensions;
  end if;
end;
$$;

-- Trigger helpers do not need to be callable through PostgREST. The legacy
-- is_admin helper remains available only to authenticated users because a few
-- older RLS policies still reference it.
revoke all on function public.set_updated_at()
  from public, anon, authenticated;
revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;
revoke all on function public.is_admin()
  from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- Index foreign-key columns used by tenant dashboards and cleanup jobs. These
-- are small, mechanical indexes identified by the database performance advisor.
create index if not exists assistant_action_logs_target_realtor_idx
  on public.assistant_action_logs(target_realtor_id);
create index if not exists assistant_action_logs_undone_by_idx
  on public.assistant_action_logs(undone_by);
create index if not exists autoenhance_batches_created_by_idx
  on public.autoenhance_batches(created_by);
create index if not exists autoenhance_batches_property_idx
  on public.autoenhance_batches(property_id);
create index if not exists autoenhance_iguide_uploads_batch_idx
  on public.autoenhance_iguide_uploads(batch_id);
create index if not exists booking_line_items_catalog_item_idx
  on public.booking_line_items(catalog_item_id);
create index if not exists booking_requests_booking_idx
  on public.booking_requests(booking_id);
create index if not exists google_calendar_connection_connected_by_idx
  on public.google_calendar_connection(connected_by);
create index if not exists iguide_jobs_property_idx
  on public.iguide_jobs(property_id);
create index if not exists iguide_webhook_events_matched_booking_idx
  on public.iguide_webhook_events(matched_booking_id);
create index if not exists integration_credentials_updated_by_idx
  on public.integration_credentials(updated_by);
create index if not exists listing_websites_booking_idx
  on public.listing_websites(booking_id);
create index if not exists organization_members_profile_idx
  on public.organization_members(profile_id);
create index if not exists quickbooks_connection_connected_by_idx
  on public.quickbooks_connection(connected_by);
create index if not exists service_prices_updated_by_idx
  on public.service_prices(updated_by);
create index if not exists telegram_connections_profile_idx
  on public.telegram_connections(profile_id);
;
