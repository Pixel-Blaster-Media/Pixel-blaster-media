alter table public.organizations
  add column if not exists email_from_name text,
  add column if not exists reply_to_email text,
  add column if not exists admin_notification_email text;

update public.organizations
set email_from_name = coalesce(email_from_name, name)
where email_from_name is null;

comment on column public.organizations.email_from_name is
  'Display name used on outbound emails. The verified sender address still comes from EMAIL_FROM.';

comment on column public.organizations.reply_to_email is
  'Company inbox used as Reply-To for client-facing emails.';

comment on column public.organizations.admin_notification_email is
  'Company inbox that receives booking and cancellation notifications.';
