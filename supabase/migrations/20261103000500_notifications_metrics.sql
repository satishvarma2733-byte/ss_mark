-- M4.6 notifications and analytics (docs/01 PRD-11; docs/06 M4.6; docs/07 s.1 GET /notifications, GET /admin/metrics).
-- In-app notifications are durable rows, one per (event key, user, channel); email is the same event delivered by the
-- worker. End reminders are keyed by the booking's committed end, so an applied extension gets a fresh reminder and a
-- repeated sweep never sends twice. Ending a booking never waits for, or depends on, a reminder.
-- Metrics are aggregates with written definitions: no contact details, no coordinates, no per-person rows. Money that
-- is collected but not yet earned (or not reconciled) is never shown as revenue.

-- Any user, booking optional (support tickets). Email is optional per event; the worker delivers it.
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

-- Booking events notify the booking's customer (unchanged behaviour, now through notify_user).
create or replace function app.job_notify_booking(p_booking_id uuid, p_event_key text, p_template text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
begin
  select customer_id into v_customer from public.bookings where id = p_booking_id;
  return app.notify_user(v_customer, p_booking_id, p_event_key, p_template);
end;
$$;

-- End reminders (worker). Only checked-in bookings, inside their reminder window, before their end.
create or replace function app.end_reminder_key(p_booking_id uuid, p_end_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'booking:' || p_booking_id || ':ending:' || to_char(p_end_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI');
$$;

create or replace function app.send_end_reminders(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_booking record;
  v_count integer := 0;
begin
  for v_booking in
    select b.id, b.customer_id, b.end_at from public.bookings b
    where b.status = 'CHECKED_IN' and b.end_at > v_now
      and b.end_at - make_interval(mins => coalesce((b.policy_snapshot ->> 'end_reminder_minutes')::integer, 10)) <= v_now
      and not exists (select 1 from public.notifications n
                      where n.user_id = b.customer_id and n.channel = 'IN_APP'
                        and n.event_key = app.end_reminder_key(b.id, b.end_at))
    order by b.end_at
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  loop
    perform app.notify_user(v_booking.customer_id, v_booking.id, app.end_reminder_key(v_booking.id, v_booking.end_at), 'booking_ending');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
create index bookings_checked_in_end_idx on public.bookings (end_at) where status = 'CHECKED_IN';

-- Refund outcomes reach the customer when the provider confirms (or definitively refuses) them.
create or replace function app.notify_refund_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('PROCESSED', 'FAILED') then
    perform app.notify_user((select customer_id from public.bookings where id = new.booking_id), new.booking_id,
                            'refund:' || new.id || ':' || lower(new.status),
                            case when new.status = 'PROCESSED' then 'refund_processed' else 'refund_delayed' end);
  end if;
  return null;
end;
$$;
create trigger refunds_notify after update of status on public.refunds
  for each row execute function app.notify_refund_outcome();

-- Support replies and resolutions reach whoever raised the ticket (customer or venue staff).
create or replace function app.notify_ticket_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.customer_visible_resolution is not null
     and new.customer_visible_resolution is distinct from old.customer_visible_resolution then
    perform app.notify_user(new.reporter_id, new.booking_id, 'ticket:' || new.id || ':reply:' || new.version, 'ticket_reply');
  elsif new.status is distinct from old.status and new.status in ('RESOLVED', 'CLOSED') then
    perform app.notify_user(new.reporter_id, new.booking_id, 'ticket:' || new.id || ':' || lower(new.status),
                            'ticket_' || lower(new.status));
  end if;
  return null;
end;
$$;
create trigger support_tickets_notify after update on public.support_tickets
  for each row execute function app.notify_ticket_change();

-- Review moderation outcome: in-app only.
create or replace function app.notify_review_moderated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.moderation_status is distinct from old.moderation_status and new.moderation_status in ('PUBLISHED', 'HIDDEN') then
    perform app.notify_user(new.customer_id, new.booking_id, 'review:' || new.id || ':' || lower(new.moderation_status),
                            'review_' || lower(new.moderation_status), false);
  end if;
  return null;
end;
$$;
create trigger reviews_notify after update of moderation_status on public.reviews
  for each row execute function app.notify_review_moderated();

-- The caller's in-app notifications, newest first. Links: booking and, for support events, the ticket.
create or replace function app.my_notifications(p_offset integer default 0, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'notification_id', n.id, 'template', n.template, 'created_at', n.created_at, 'read_at', n.read_at,
           'booking_id', n.booking_id, 'public_ref', b.public_ref, 'venue_name', v.name,
           'ticket_id', case when n.event_key like 'ticket:%' then app.try_uuid(split_part(n.event_key, ':', 2)) end)
         order by n.created_at desc, n.id), '[]'::jsonb)
    into v_rows
  from (select * from public.notifications
        where user_id = v_actor and channel = 'IN_APP'
        order by created_at desc, id
        offset v_offset limit v_limit + 1) n
  left join public.bookings b on b.id = n.booking_id
  left join public.venues v on v.id = b.venue_id;
  return jsonb_build_object(
    'notifications', (select coalesce(jsonb_agg(t.x order by t.i), '[]'::jsonb)
                      from jsonb_array_elements(v_rows) with ordinality as t (x, i) where t.i <= v_limit),
    'has_more', jsonb_array_length(v_rows) > v_limit,
    'next_offset', case when jsonb_array_length(v_rows) > v_limit then v_offset + v_limit end,
    'unread', (select count(*) from public.notifications where user_id = v_actor and channel = 'IN_APP' and read_at is null));
end;
$$;

-- Marks one (or every) in-app notification of the caller read. Idempotent; delivery status never changes here.
create or replace function app.mark_notifications_read(p_notification_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_count integer;
begin
  update public.notifications set read_at = clock_timestamp()
   where user_id = v_actor and channel = 'IN_APP' and read_at is null
     and (p_notification_id is null or id = p_notification_id);
  get diagnostics v_count = row_count;
  if p_notification_id is not null and v_count = 0
     and not exists (select 1 from public.notifications where id = p_notification_id and user_id = v_actor and channel = 'IN_APP') then
    perform app.fail('NOT_FOUND');
  end if;
  return jsonb_build_object('marked', v_count,
    'unread', (select count(*) from public.notifications where user_id = v_actor and channel = 'IN_APP' and read_at is null));
end;
$$;

-- Business metrics (A06) -----------------------------------------------------------------------------------------------
-- Definitions are published with the numbers (contracts METRIC_DEFINITIONS). Periods are IST calendar days.
create or replace function app.admin_business_metrics(p_from date, p_to date, p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin(array['SUPPORT', 'FINANCE', 'SUPERADMIN']);
  v_finance boolean := app.has_platform_role(array['FINANCE', 'SUPERADMIN']);
  v_start timestamptz;
  v_end timestamptz;
  v_funnel jsonb;
  v_outcomes jsonb;
  v_occupancy jsonb;
  v_repeat jsonb;
  v_reliability jsonb;
  v_finance_block jsonb;
  v_run public.reconciliation_runs;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'period'));
  end if;
  if p_venue_id is not null and not exists (select 1 from public.venues where id = p_venue_id) then
    perform app.fail('NOT_FOUND');
  end if;
  v_start := p_from::timestamp at time zone 'Asia/Kolkata';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';

  -- Funnel: every booking starts as a hold; created in the period.
  select jsonb_build_object(
           'holds', count(*),
           'paid', count(*) filter (where b.confirmed_at is not null),
           'expired_unpaid', count(*) filter (where b.status = 'EXPIRED'),
           'abandoned', count(*) filter (where b.status = 'CANCELLED' and b.confirmed_at is null))
    into v_funnel
  from public.bookings b
  where b.created_at >= v_start and b.created_at < v_end and (p_venue_id is null or b.venue_id = p_venue_id);

  -- Outcomes of paid bookings that started in the period.
  select jsonb_build_object(
           'paid_bookings', count(*),
           'completed', count(*) filter (where b.status = 'COMPLETED'),
           'no_show', count(*) filter (where b.status = 'NO_SHOW'),
           'customer_cancelled', count(*) filter (where b.status = 'CANCELLED' and b.cancel_reason like 'CUSTOMER:%'),
           'service_cancelled', count(*) filter (where b.status = 'CANCELLED' and b.cancel_reason like 'SERVICE:%'),
           'in_progress', count(*) filter (where b.status in ('CONFIRMED', 'CHECKED_IN')))
    into v_outcomes
  from public.bookings b
  where b.confirmed_at is not null and b.start_at >= v_start and b.start_at < v_end
    and (p_venue_id is null or b.venue_id = p_venue_id);

  -- Occupancy: paid table-minutes (not cancelled) over bookable table-minutes from each venue's current opening hours.
  select jsonb_build_object(
           'booked_minutes', (select coalesce(sum(extract(epoch from (b.end_at - b.start_at)) / 60), 0)::bigint
                              from public.bookings b
                              where b.confirmed_at is not null and b.status in ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW')
                                and b.start_at >= v_start and b.start_at < v_end
                                and (p_venue_id is null or b.venue_id = p_venue_id)),
           'open_minutes', (select coalesce(sum(extract(epoch from (op.closes_local - op.opens_local)) / 60
                                                + case when op.closes_next_day then 1440 else 0 end), 0)::bigint
                            from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d (day)
                            join public.venues v on v.status = 'PUBLISHED' and (p_venue_id is null or v.id = p_venue_id)
                            join public.opening_periods op on op.venue_id = v.id and op.schedule_version = v.active_schedule_version
                                                          and op.weekday = extract(dow from d.day)::integer
                            join public.resources r on r.venue_id = v.id and r.status = 'ACTIVE'))
    into v_occupancy;

  -- Repeat: customers with a paid booking starting in the period who had an earlier paid booking.
  select jsonb_build_object('customers', count(*), 'repeat_customers', count(*) filter (where c.earlier))
    into v_repeat
  from (select b.customer_id,
               exists (select 1 from public.bookings e
                       where e.customer_id = b.customer_id and e.confirmed_at is not null and e.start_at < min(b.start_at)) as earlier
        from public.bookings b
        where b.confirmed_at is not null and b.start_at >= v_start and b.start_at < v_end
          and (p_venue_id is null or b.venue_id = p_venue_id)
        group by b.customer_id) c;

  select jsonb_build_object(
           'extension_requests', (select count(*) from public.extension_requests x
                                  where x.created_at >= v_start and x.created_at < v_end and (p_venue_id is null or x.venue_id = p_venue_id)),
           'extensions_decided_in_time', (select count(*) from public.extension_requests x
                                          where x.created_at >= v_start and x.created_at < v_end
                                            and (p_venue_id is null or x.venue_id = p_venue_id)
                                            and x.decided_at is not null and x.decided_at <= x.request_expires_at),
           'extensions_applied', (select count(*) from public.extension_requests x
                                  where x.created_at >= v_start and x.created_at < v_end
                                    and (p_venue_id is null or x.venue_id = p_venue_id) and x.status = 'APPLIED'),
           'refunds_requested', (select count(*) from public.refunds f join public.bookings b on b.id = f.booking_id
                                 where f.created_at >= v_start and f.created_at < v_end and (p_venue_id is null or b.venue_id = p_venue_id)),
           'refunds_processed', (select count(*) from public.refunds f join public.bookings b on b.id = f.booking_id
                                 where f.created_at >= v_start and f.created_at < v_end and (p_venue_id is null or b.venue_id = p_venue_id)
                                   and f.status = 'PROCESSED'),
           'refunds_failed_or_unknown', (select count(*) from public.refunds f join public.bookings b on b.id = f.booking_id
                                         where f.created_at >= v_start and f.created_at < v_end
                                           and (p_venue_id is null or b.venue_id = p_venue_id) and f.status in ('FAILED', 'UNKNOWN')),
           'median_refund_minutes', (select round((percentile_cont(0.5) within group (
                                               order by extract(epoch from (f.processed_at - f.created_at)) / 60))::numeric, 1)
                                     from public.refunds f join public.bookings b on b.id = f.booking_id
                                     where f.created_at >= v_start and f.created_at < v_end
                                       and (p_venue_id is null or b.venue_id = p_venue_id) and f.status = 'PROCESSED'),
           'check_in_attempts', (select count(*) from public.arrival_attempts a
                                 where a.created_at >= v_start and a.created_at < v_end and (p_venue_id is null or a.venue_id = p_venue_id)),
           'check_in_failures', (select count(*) from public.arrival_attempts a
                                 where a.created_at >= v_start and a.created_at < v_end and (p_venue_id is null or a.venue_id = p_venue_id)
                                   and a.outcome = 'FAILED'),
           'end_reminders', (select count(*) from public.notifications n left join public.bookings b on b.id = n.booking_id
                             where n.channel = 'IN_APP' and n.template = 'booking_ending'
                               and n.created_at >= v_start and n.created_at < v_end
                               and (p_venue_id is null or b.venue_id = p_venue_id)))
    into v_reliability;

  if v_finance then
    select * into v_run from public.reconciliation_runs
     where status in ('MATCHED', 'MISMATCH') and period_from <= v_end and period_to >= v_start
     order by completed_at desc limit 1;
    select jsonb_build_object(
             'collected_paise', (select coalesce(sum(a.amount_paise), 0)::bigint from public.payment_attempts a
                                 join public.bookings b on b.id = a.booking_id
                                 where a.state = 'CAPTURED' and a.captured_at >= v_start and a.captured_at < v_end
                                   and (p_venue_id is null or b.venue_id = p_venue_id)),
             'refunded_paise', (select coalesce(sum(f.amount_paise), 0)::bigint from public.refunds f
                                join public.bookings b on b.id = f.booking_id
                                where f.status = 'PROCESSED' and f.processed_at >= v_start and f.processed_at < v_end
                                  and (p_venue_id is null or b.venue_id = p_venue_id)),
             'earned_gross_paise', (select coalesce(sum(e.gross_paise), 0)::bigint from public.booking_earnings e
                                    where e.earned_at >= v_start and e.earned_at < v_end and (p_venue_id is null or e.venue_id = p_venue_id)),
             'platform_fee_paise', (select coalesce(sum(e.platform_fee_paise), 0)::bigint from public.booking_earnings e
                                    where e.earned_at >= v_start and e.earned_at < v_end and (p_venue_id is null or e.venue_id = p_venue_id)),
             'partner_earned_paise', (select coalesce(sum(e.partner_paise), 0)::bigint from public.booking_earnings e
                                      where e.earned_at >= v_start and e.earned_at < v_end and (p_venue_id is null or e.venue_id = p_venue_id)),
             'reconciliation', case when v_run.id is null then 'NONE'
                                    when v_run.status = 'MATCHED' and v_run.period_from <= v_start and v_run.period_to >= v_end then 'MATCHED'
                                    when v_run.status = 'MATCHED' then 'PARTIAL'
                                    else 'MISMATCH' end)
      into v_finance_block;
  end if;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'timezone', 'Asia/Kolkata', 'venue_id', p_venue_id,
    'funnel', v_funnel, 'outcomes', v_outcomes, 'occupancy', v_occupancy, 'repeat', v_repeat, 'reliability', v_reliability,
    'finance', v_finance_block, 'generated_at', clock_timestamp());
end;
$$;

grant execute on function
  app.my_notifications(integer, integer),
  app.mark_notifications_read(uuid),
  app.admin_business_metrics(date, date, uuid)
  to authenticated;
grant execute on function app.send_end_reminders(integer) to simply_worker;
-- Internal: notify_user, end_reminder_key, notify_refund_outcome, notify_ticket_change, notify_review_moderated.
revoke execute on all functions in schema app from public;
