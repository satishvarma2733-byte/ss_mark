-- Notification preferences (Figma "Notifications · Notification preferences", 94:22428; docs/01 PRD-11).
-- Three tiers, as in the frame:
--   1. Essential booking and security messages: always created in the inbox, and the essential ones are always emailed
--      (cancellation, no-show, refunds, extension decisions that need action, support replies). Not switchable.
--   2. Email copies of optional updates: confirmation copy, end-of-time reminder, "booking extended", review outcome,
--      ticket resolved/closed. One switch. DEFAULT ON, which is exactly the behaviour before this migration (the frame
--      shows "Off" as an example state; turning the default off is an owner decision, not made here).
--   3. Offers and announcements: stored choice only, default off. Nothing in this system sends marketing.
-- A missing row means the defaults. The inbox (IN_APP) row is never affected by any preference.
create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id),
  email_copies boolean not null default true,
  marketing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
comment on table public.notification_preferences is 'Per-person optional notification choices. Essential messages ignore this table.';
create trigger notification_preferences_touch before update on public.notification_preferences for each row execute function app.touch_row();
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

-- Templates whose EMAIL copy is optional. Everything else is essential and is always emailed.
create or replace function app.is_optional_email(p_template text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_template in ('booking_confirmed', 'booking_ending', 'extension_applied', 'review_published', 'review_hidden',
                        'ticket_resolved', 'ticket_closed');
$$;

-- Same contract as before (20261103000500), plus: an optional email is skipped when the person turned email copies off.
create or replace function app.notify_user(p_user_id uuid, p_booking_id uuid, p_event_key text, p_template text, p_email boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email_id uuid;
  v_status text;
begin
  if p_user_id is null then
    return 0;
  end if;
  insert into public.notifications (user_id, booking_id, event_key, channel, template)
  values (p_user_id, p_booking_id, p_event_key, 'IN_APP', p_template)
  on conflict (event_key, user_id, channel) do nothing;
  if not p_email then
    return 0;
  end if;
  if app.is_optional_email(p_template)
     and exists (select 1 from public.notification_preferences where user_id = p_user_id and not email_copies) then
    return 0;
  end if;
  insert into public.notifications (user_id, booking_id, event_key, channel, template)
  values (p_user_id, p_booking_id, p_event_key, 'EMAIL', p_template)
  on conflict (event_key, user_id, channel) do nothing;
  select id, status into v_email_id, v_status from public.notifications
   where event_key = p_event_key and user_id = p_user_id and channel = 'EMAIL';
  if v_status = 'QUEUED' then
    perform app.enqueue_job('notification:' || v_email_id || ':email', 'notification.email',
                            jsonb_build_object('notification_id', v_email_id));
    return 1;
  end if;
  return 0;
end;
$$;

create or replace function app.my_notification_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
begin
  return coalesce(
    (select jsonb_build_object('email_copies', email_copies, 'marketing', marketing, 'updated_at', updated_at)
       from public.notification_preferences where user_id = v_actor),
    jsonb_build_object('email_copies', true, 'marketing', false, 'updated_at', null));
end;
$$;

create or replace function app.set_notification_preferences(p_email_copies boolean, p_marketing boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
begin
  if p_email_copies is null or p_marketing is null then
    perform app.fail('VALIDATION_FAILED');
  end if;
  insert into public.notification_preferences (user_id, email_copies, marketing)
  values (v_actor, p_email_copies, p_marketing)
  on conflict (user_id) do update set email_copies = excluded.email_copies, marketing = excluded.marketing;
  return app.my_notification_preferences();
end;
$$;

grant execute on function
  app.my_notification_preferences(),
  app.set_notification_preferences(boolean, boolean)
  to authenticated;
-- Internal: is_optional_email, notify_user.
revoke execute on all functions in schema app from public;
