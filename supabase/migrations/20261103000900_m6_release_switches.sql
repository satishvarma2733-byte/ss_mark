-- M6 release switches (docs/06 rollback procedure, docs/08 s.4). A critical fault disables new holds and extensions
-- while existing booking visibility, arrivals, payment/refund ingestion and reconciliation keep working; booking is
-- enabled behind a switch only after operational approval. The switches are enforced here, on the rows that create new
-- commitments, so no API, worker or future code path can sell around them:
--   BOOKINGS   new quotes, new holds, new payment orders for a booking hold;
--   EXTENSIONS new extension requests, extension holds, payment orders for an extension;
--   PAYOUTS    payout approval and the move to PROCESSING (recording an already-made transfer as PAID stays possible).
-- Rows are inserted closed: a fresh production database takes no bookings until a superadmin opens it. The local seed
-- opens them. A change applies to transactions that reach the check after it commits.
create table public.release_switches (
  key text primary key check (key in ('BOOKINGS', 'EXTENSIONS', 'PAYOUTS')),
  is_open boolean not null default false,
  reason text check (reason is null or char_length(reason) between 10 and 500),
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
comment on table public.release_switches is 'Server switches for new sales. Closed blocks new commitments only; existing ones continue.';
create trigger release_switches_touch before update on public.release_switches for each row execute function app.touch_row();
alter table public.release_switches enable row level security;
alter table public.release_switches force row level security;

insert into public.release_switches (key, is_open, reason) values
  ('BOOKINGS', false, 'Closed until operational approval (docs/08 s.4).'),
  ('EXTENSIONS', false, 'Closed until operational approval (docs/08 s.4).'),
  ('PAYOUTS', false, 'Closed until operational approval (docs/08 s.4).');

create or replace function app.switch_open(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_open from public.release_switches where key = p_key), false);
$$;

create or replace function app.require_switch_open(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.switch_open(p_key) then
    perform app.fail(p_key || '_PAUSED');
  end if;
end;
$$;

-- Guard triggers ------------------------------------------------------------------------------------------------------
create or replace function app.guard_new_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_switch_open('BOOKINGS');
  return new;
end;
$$;
create trigger quotes_release_switch before insert on public.quotes for each row execute function app.guard_new_quote();

create or replace function app.guard_new_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_switch_open('BOOKINGS');
  return new;
end;
$$;
create trigger bookings_release_switch before insert on public.bookings for each row execute function app.guard_new_booking();

create or replace function app.guard_new_payment_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_switch_open(case when new.extension_id is null then 'BOOKINGS' else 'EXTENSIONS' end);
  return new;
end;
$$;
create trigger payment_orders_release_switch before insert on public.payment_orders
  for each row execute function app.guard_new_payment_order();

create or replace function app.guard_extension_switch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (new.status = 'HELD' and old.status is distinct from 'HELD') then
    perform app.require_switch_open('EXTENSIONS');
  end if;
  return new;
end;
$$;
create trigger extension_requests_release_switch before insert or update of status on public.extension_requests
  for each row execute function app.guard_extension_switch();

create or replace function app.guard_payout_switch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('APPROVED', 'PROCESSING') and old.status is distinct from new.status then
    perform app.require_switch_open('PAYOUTS');
  end if;
  return new;
end;
$$;
create trigger payout_batches_release_switch before update of status on public.payout_batches
  for each row execute function app.guard_payout_switch();

-- Reads and changes ---------------------------------------------------------------------------------------------------
-- Public: what customers may start right now. Nothing internal (reasons, people) leaves the database.
create or replace function app.service_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('bookings_open', app.switch_open('BOOKINGS'), 'extensions_open', app.switch_open('EXTENSIONS'));
$$;

create or replace function app.release_switch_json(p_switch public.release_switches)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'key', p_switch.key, 'is_open', p_switch.is_open, 'reason', p_switch.reason, 'changed_at', p_switch.changed_at,
    'changed_by_name', (select display_name from public.profiles where id = p_switch.changed_by), 'version', p_switch.version,
    'can_change', app.has_platform_role(case when p_switch.key = 'PAYOUTS' then array['FINANCE', 'SUPERADMIN'] else array['SUPERADMIN'] end)
  );
$$;

-- Every platform administrator can see the switches (support answers customers during an incident).
create or replace function app.admin_release_switches()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin(array['SUPPORT', 'FINANCE', 'SUPERADMIN']);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(app.release_switch_json(s) order by array_position(array['BOOKINGS', 'EXTENSIONS', 'PAYOUTS'], s.key))
      from public.release_switches s), '[]'::jsonb));
end;
$$;

-- Superadmin opens/closes sales; finance may also pause or release payouts. Reason, TOTP and audit are required.
-- Setting a switch to the state it already has is a no-op that reports changed = false.
create or replace function app.admin_set_release_switch(p_key text, p_open boolean, p_reason text, p_expected_version integer,
                                                        p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor uuid;
  v_switch public.release_switches;
begin
  if p_key is null or p_key not in ('BOOKINGS', 'EXTENSIONS', 'PAYOUTS') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'key'));
  end if;
  v_actor := app.require_platform_admin(case when p_key = 'PAYOUTS' then array['FINANCE', 'SUPERADMIN'] else array['SUPERADMIN'] end);
  if p_open is null then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'is_open'));
  end if;
  if char_length(v_reason) not between 10 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  select * into v_switch from public.release_switches where key = p_key for update;
  if v_switch.is_open = p_open then
    return app.release_switch_json(v_switch) || jsonb_build_object('changed', false);
  end if;
  if v_switch.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_switch.version));
  end if;
  update public.release_switches
     set is_open = p_open, reason = v_reason, changed_by = v_actor, changed_at = clock_timestamp()
   where key = p_key returning * into v_switch;
  perform app.audit(v_actor, case when app.has_platform_role(array['SUPERADMIN']) then 'SUPERADMIN' else 'FINANCE' end,
                    case when p_open then 'release_switch.opened' else 'release_switch.closed' end, 'release_switch', null, null,
                    p_request_id, v_reason, jsonb_build_object('key', p_key, 'is_open', p_open));
  return app.release_switch_json(v_switch) || jsonb_build_object('changed', true);
end;
$$;

grant execute on function app.service_status() to anon, authenticated;
grant execute on function app.admin_release_switches(), app.admin_set_release_switch(text, boolean, text, integer, uuid)
  to authenticated;
revoke execute on all functions in schema app from public;
