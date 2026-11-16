-- M5.3 reliability: the earnings sweep runs every worker tick. Scanning every finished booking for one without an
-- earning grows with all history; instead, finished paid bookings are queued when their status changes and leave the
-- queue when their earning is recorded, so a tick reads only pending work.

create table public.earning_queue (
  booking_id uuid primary key references public.bookings (id),
  queued_at timestamptz not null default now()
);
create index earning_queue_queued_idx on public.earning_queue (queued_at);
alter table public.earning_queue enable row level security;
alter table public.earning_queue force row level security;
-- No client grants: written by triggers, read by the worker sweep.

create or replace function app.queue_earning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW') and new.status is distinct from old.status
     and exists (select 1 from public.payment_attempts a where a.booking_id = new.id and a.allocation_state = 'BOOKING')
     and not exists (select 1 from public.booking_earnings e where e.booking_id = new.id) then
    insert into public.earning_queue (booking_id) values (new.id) on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger bookings_queue_earning after update of status on public.bookings
  for each row execute function app.queue_earning();

create or replace function app.dequeue_earning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.earning_queue where booking_id = new.booking_id;
  return null;
end;
$$;
create trigger booking_earnings_dequeue after insert on public.booking_earnings
  for each row execute function app.dequeue_earning();

-- Finished paid bookings already waiting when this migration runs.
insert into public.earning_queue (booking_id, queued_at)
select b.id, b.updated_at from public.bookings b
where b.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW')
  and exists (select 1 from public.payment_attempts a where a.booking_id = b.id and a.allocation_state = 'BOOKING')
  and not exists (select 1 from public.booking_earnings e where e.booking_id = b.id)
on conflict do nothing;

-- Same sweep, reading the queue. A no-show stays queued until its paid interval has ended.
create or replace function app.recognize_earnings(p_limit integer default 100, p_partner_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_now timestamptz := clock_timestamp();
  v_count integer := 0;
begin
  for v_booking in
    select b.* from public.earning_queue q
    join public.bookings b on b.id = q.booking_id
    where (b.status <> 'NO_SHOW' or b.end_at <= v_now)
      and (p_partner_id is null or b.venue_id in (select v.id from public.venues v where v.partner_id = p_partner_id))
    order by q.queued_at
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update of b skip locked
  loop
    if (app.recognize_booking_earning(v_booking, v_now)).id is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Internal: queue_earning, dequeue_earning.
revoke execute on all functions in schema app from public;
