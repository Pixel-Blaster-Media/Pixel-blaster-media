-- Supabase projects can grant broad table privileges through default
-- privileges. Keep browser clients to the four operations covered by RLS.
revoke all on table public.push_subscriptions from authenticated;
grant select, insert, update, delete on table public.push_subscriptions
  to authenticated;
