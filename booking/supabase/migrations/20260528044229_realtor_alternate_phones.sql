alter table public.profiles
  add column if not exists alternate_phones text[] not null default '{}';

comment on column public.profiles.alternate_phones is
  'Additional phone numbers that can identify this realtor during public booking lookup.';;
