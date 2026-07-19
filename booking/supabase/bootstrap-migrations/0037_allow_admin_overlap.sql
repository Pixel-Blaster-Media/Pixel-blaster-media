-- ============================================================================
-- Pixel Blaster Booking — Phase 37: allow intentional admin double-booking
-- ----------------------------------------------------------------------------
-- The Phase 13 exclusion constraint rejected ANY overlapping active bookings
-- at the database level. In practice the photographer intentionally overlaps
-- shoots (e.g. books over the tail of a job that won't use its full slot), so
-- the hard constraint blocks a legitimate workflow.
--
-- Overlap protection for realtor-facing flows is unchanged: the public
-- booking flow only offers slots the availability engine says are free, and
-- both the public flow and the self-serve manage page re-check for conflicts
-- in application code before writing. Dropping the constraint only removes
-- the atomic backstop (a sub-second race between two simultaneous public
-- submissions), which is an accepted trade-off for admin flexibility.
-- ============================================================================

alter table public.bookings
  drop constraint if exists bookings_active_schedule_no_overlap;
