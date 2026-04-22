-- ============================================================================
-- Pixel Blaster Booking — Phase 9: Cart on booking_requests
--
-- The /book form (and /portal/book) now write an ordered cart of catalog
-- items + quantities alongside the legacy services[] / add_ons[] arrays.
-- Storing it as JSON lets us capture a-la-carte quantities (e.g. 2x
-- Interior Retakes) without introducing another child table.
--
-- Shape: [{ "catalog_item_id": "uuid", "slug": "blue_print", "quantity": 1 }]
--
-- The slug is denormalized for display-without-a-join in the admin inbox.
-- The id is the source of truth for pricing + duration lookups.
-- ============================================================================

alter table public.booking_requests
  add column if not exists cart jsonb not null default '[]'::jsonb;
