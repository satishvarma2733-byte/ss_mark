-- M4.4 finance and admin (docs/03 P07, A05; docs/05 money tables; docs/07 s.4, s.7; docs/08 T17, T18).
-- PROPOSED posting policy, pending finance review before any live money (decisions D04/D05):
--   earned       CUSTOMER_BOOKING_LIABILITY -> partner PARTNER_PAYABLE + PLATFORM_FEE_REVENUE, split by the booking's
--                price snapshot commission, once the booking is finished (completed, no-show after its end, cancelled
--                with money retained).
--   admin refund before earning it reduces the booking liability; after earning it is charged to the partner (the
--                payable may go negative and is netted from the next payout) or to the platform.
--   payout       PARTNER_PAYABLE -> GATEWAY_CLEARING, only when marked PAID with an evidence reference. Transfers are
--                recorded here, never performed, until a provider payout model is approved.
-- Payout approval needs a second finance person, the payable re-checked under the partner lock, and a MATCHED
-- reconciliation covering every capture behind the batch. A mismatch freezes approval until a new matched run.

insert into public.ledger_accounts (code, account_type) values
  ('PLATFORM_FEE_REVENUE', 'REVENUE'),
  ('PLATFORM_ADJUSTMENT_EXPENSE', 'EXPENSE');

alter table public.ledger_journals drop constraint ledger_journals_kind_check;
alter table public.ledger_journals add constraint ledger_journals_kind_check check (kind in (
  'CAPTURE_ALLOCATED_BOOKING', 'CAPTURE_ALLOCATED_EXTENSION', 'CAPTURE_REFUND_DUE', 'CAPTURE_QUARANTINED', 'REFUND_PROCESSED',
  'CANCELLATION_REFUND_DUE', 'NO_SHOW_REFUND_DUE', 'BOOKING_EARNED', 'ADMIN_REFUND_DUE', 'PAYOUT_PAID'
));
create index ledger_journals_attempt_idx on public.ledger_journals (payment_attempt_id) where payment_attempt_id is not null;
create index ledger_journals_refund_idx on public.ledger_journals (refund_id) where refund_id is not null;

-- Admin refunds say who bears them and why; both are fixed once written.
alter table public.refunds drop constraint refunds_reason_code_check;
alter table public.refunds add constraint refunds_reason_code_check check (reason_code in (
  'LATE_CAPTURE', 'CANCELLED_HOLD_CAPTURE', 'DUPLICATE_CAPTURE', 'CUSTOMER_CANCEL', 'SERVICE_CANCEL', 'NO_SHOW', 'ADMIN_REFUND'
));
alter table public.refunds
  add column charge_to text check (charge_to in ('BOOKING', 'PARTNER', 'PLATFORM')),
  add column admin_reason text check (admin_reason is null or char_length(admin_reason) between 10 and 500),
  add constraint refunds_admin_fields check (
    (reason_code = 'ADMIN_REFUND') = (charge_to is not null and admin_reason is not null and requested_by is not null));
create index refunds_partner_charge_idx on public.refunds (charge_to) where charge_to = 'PARTNER';

create or replace function app.guard_refund_admin_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.reason_code, new.charge_to, new.admin_reason, new.requested_by)
     is distinct from (old.reason_code, old.charge_to, old.admin_reason, old.requested_by) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'refunds', 'reason', 'admin_fields'));
  end if;
  return new;
end;
$$;
create trigger refunds_admin_fields before update on public.refunds
  for each row execute function app.guard_refund_admin_fields();

-- Fee versions: drafted by one finance person, approved by another.
alter table public.fee_configurations
  add column created_by uuid references public.profiles (id),
  add constraint fee_configurations_two_people check (approved_by is null or created_by is null or approved_by <> created_by);

-- Earnings: one row per finished paid booking. Zero rows (fully refunded) are kept so the booking reads as settled.
create table public.booking_earnings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id),
  venue_id uuid not null references public.venues (id),
  partner_id uuid not null references public.partners (id),
  booking_status text not null check (booking_status in ('COMPLETED', 'NO_SHOW', 'CANCELLED')),
  gross_paise bigint not null check (gross_paise >= 0),
  platform_fee_paise bigint not null check (platform_fee_paise >= 0),
  partner_paise bigint not null check (partner_paise >= 0),
  commission_bps integer not null check (commission_bps between 0 and 10000),
  platform_fixed_paise bigint not null check (platform_fixed_paise >= 0),
  fee_config_version text not null,
  journal_id uuid references public.ledger_journals (id),
  earned_at timestamptz not null default now(),
  constraint booking_earnings_split check (gross_paise = platform_fee_paise + partner_paise),
  constraint booking_earnings_journal check (gross_paise = 0 or journal_id is not null)
);
create index booking_earnings_partner_idx on public.booking_earnings (partner_id, earned_at);
create index booking_earnings_venue_idx on public.booking_earnings (venue_id, earned_at);
create trigger booking_earnings_append_only before update or delete on public.booking_earnings
  for each row execute function app.forbid_change();

-- Reconciliation: provider captures/refunds for a period against local records and the ledger, by provider ID.
create table public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('mock')),
  environment text not null check (environment in ('TEST', 'LIVE')),
  period_from timestamptz not null,
  period_to timestamptz not null,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'MATCHED', 'MISMATCH', 'FAILED')),
  requested_by uuid not null references public.profiles (id),
  provider_captures integer,
  provider_captured_paise bigint,
  local_captures integer,
  local_captured_paise bigint,
  provider_refunds integer,
  provider_refunded_paise bigint,
  local_refunds integer,
  local_refunded_paise bigint,
  exception_count integer not null default 0,
  error_code text check (error_code is null or char_length(error_code) <= 60),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint reconciliation_runs_period check (period_to > period_from and period_to - period_from <= interval '31 days'),
  constraint reconciliation_runs_completed check (status = 'RUNNING' or completed_at is not null)
);
create index reconciliation_runs_completed_idx on public.reconciliation_runs (status, completed_at desc);

create table public.reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.reconciliation_runs (id),
  kind text not null check (kind in ('MISSING_LOCALLY', 'MISSING_AT_PROVIDER', 'AMOUNT_MISMATCH', 'STATE_MISMATCH', 'LEDGER_MISSING')),
  object_type text not null check (object_type in ('PAYMENT', 'REFUND')),
  provider_ref text,
  local_id uuid,
  booking_id uuid references public.bookings (id),
  provider_amount_paise bigint,
  local_amount_paise bigint,
  created_at timestamptz not null default now()
);
create index reconciliation_exceptions_run_idx on public.reconciliation_exceptions (run_id);
create trigger reconciliation_exceptions_append_only before update or delete on public.reconciliation_exceptions
  for each row execute function app.forbid_change();

create or replace function app.guard_reconciliation_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.status <> 'RUNNING'
     or (new.period_from, new.period_to, new.provider, new.environment, new.requested_by)
        is distinct from (old.period_from, old.period_to, old.provider, old.environment, old.requested_by) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'reconciliation_runs'));
  end if;
  return new;
end;
$$;
create trigger reconciliation_runs_guard before update or delete on public.reconciliation_runs
  for each row execute function app.guard_reconciliation_run();

-- Payouts. One open batch per partner; allocations reserve each earning/adjustment for at most one live batch.
create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique,
  partner_id uuid not null references public.partners (id),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED')),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  amount_paise bigint not null check (amount_paise > 0),
  earnings_paise bigint not null check (earnings_paise > 0),
  adjustments_paise bigint not null check (adjustments_paise >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  reconciliation_run_id uuid references public.reconciliation_runs (id),
  transfer_ref text check (transfer_ref is null or char_length(transfer_ref) between 6 and 120),
  evidence_ref text check (evidence_ref is null or char_length(evidence_ref) between 6 and 120),
  marked_by uuid references public.profiles (id),
  paid_at timestamptz,
  status_reason text check (status_reason is null or char_length(status_reason) between 3 and 500),
  journal_id uuid references public.ledger_journals (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint payout_batches_amount check (amount_paise = earnings_paise - adjustments_paise),
  constraint payout_batches_period check (period_end >= period_start),
  constraint payout_batches_two_people check (approved_by is null or approved_by <> created_by),
  constraint payout_batches_approved check (
    status in ('DRAFT', 'CANCELLED') or (approved_by is not null and approved_at is not null and reconciliation_run_id is not null)),
  constraint payout_batches_paid_evidence check (
    status <> 'PAID' or (evidence_ref is not null and paid_at is not null and journal_id is not null))
);
comment on column public.payout_batches.evidence_ref is 'Provider transfer or bank reference proving the payout. PAID needs it.';
create unique index payout_batches_one_open on public.payout_batches (partner_id) where status in ('DRAFT', 'APPROVED', 'PROCESSING');
create index payout_batches_partner_idx on public.payout_batches (partner_id, created_at desc);
create trigger payout_batches_touch before update on public.payout_batches for each row execute function app.touch_row();

create or replace function app.guard_payout_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'payout_batches'));
  end if;
  if (new.partner_id, new.amount_paise, new.earnings_paise, new.adjustments_paise, new.period_start, new.period_end,
      new.created_by, new.public_ref)
     is distinct from (old.partner_id, old.amount_paise, old.earnings_paise, old.adjustments_paise, old.period_start,
                       old.period_end, old.created_by, old.public_ref) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'payout_batches', 'reason', 'identity'));
  end if;
  if new.status <> old.status and not (
       (old.status = 'DRAFT' and new.status in ('APPROVED', 'CANCELLED'))
    or (old.status = 'APPROVED' and new.status in ('PROCESSING', 'PAID', 'FAILED'))
    or (old.status = 'PROCESSING' and new.status in ('PAID', 'FAILED'))) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if old.status in ('PAID', 'FAILED', 'CANCELLED') then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'payout_batches'));
  end if;
  return new;
end;
$$;
create trigger payout_batches_guard before update or delete on public.payout_batches
  for each row execute function app.guard_payout_batch();

create table public.payout_allocations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payout_batches (id),
  partner_id uuid not null references public.partners (id),
  venue_id uuid not null references public.venues (id),
  booking_id uuid not null references public.bookings (id),
  kind text not null check (kind in ('EARNING', 'ADJUSTMENT')),
  booking_earning_id uuid references public.booking_earnings (id),
  refund_id uuid references public.refunds (id),
  amount_paise bigint not null,
  active boolean not null default true,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payout_allocations_kind check (
    (kind = 'EARNING' and booking_earning_id is not null and refund_id is null and amount_paise > 0)
    or (kind = 'ADJUSTMENT' and refund_id is not null and booking_earning_id is null and amount_paise < 0)),
  constraint payout_allocations_released check (active = (released_at is null))
);
comment on column public.payout_allocations.amount_paise is 'Signed: earnings positive, partner-charged refunds negative.';
create unique index payout_allocations_earning_once on public.payout_allocations (booking_earning_id) where active;
create unique index payout_allocations_refund_once on public.payout_allocations (refund_id) where active;
create index payout_allocations_batch_idx on public.payout_allocations (batch_id);
create index payout_allocations_venue_idx on public.payout_allocations (venue_id, created_at);

-- Allocations are only ever released (failed or cancelled batch); nothing else changes.
create or replace function app.guard_payout_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or not old.active or new.active
     or (new.batch_id, new.kind, new.booking_earning_id, new.refund_id, new.amount_paise)
        is distinct from (old.batch_id, old.kind, old.booking_earning_id, old.refund_id, old.amount_paise) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'payout_allocations'));
  end if;
  return new;
end;
$$;
create trigger payout_allocations_guard before update or delete on public.payout_allocations
  for each row execute function app.guard_payout_allocation();

do $$
declare
  t text;
begin
  foreach t in array array['booking_earnings', 'reconciliation_runs', 'reconciliation_exceptions', 'payout_batches',
                           'payout_allocations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end
$$;
-- No client grants: read and written only through the functions below.

-- Ledger helpers ----------------------------------------------------------------------------------------------------
-- A partner's own account, created on first posting. Only partner liability codes exist per partner.
create or replace function app.partner_account(p_partner_id uuid, p_code text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_code <> 'PARTNER_PAYABLE' then
    perform app.fail('INTERNAL_ERROR', jsonb_build_object('reason', 'unknown_partner_account', 'account', p_code));
  end if;
  insert into public.ledger_accounts (partner_id, code, account_type) values (p_partner_id, p_code, 'LIABILITY')
  on conflict (partner_id, code, currency) do nothing;
  select id into v_id from public.ledger_accounts where partner_id = p_partner_id and code = p_code and currency = 'INR' and enabled;
  return v_id;
end;
$$;

-- Posts one journal idempotently by business key. Entries: [{"account": "CODE", "side": "DEBIT", "amount_paise": n}];
-- an entry with "partner_id" posts to that partner's account.
create or replace function app.post_journal(
  p_business_key text, p_kind text, p_booking_id uuid, p_attempt_id uuid, p_refund_id uuid, p_evidence text, p_entries jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  e jsonb;
  v_account uuid;
begin
  insert into public.ledger_journals (business_key, kind, booking_id, payment_attempt_id, refund_id, evidence_ref)
  values (p_business_key, p_kind, p_booking_id, p_attempt_id, p_refund_id, p_evidence)
  on conflict (business_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.ledger_journals where business_key = p_business_key;
    return v_id;
  end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    if e ? 'partner_id' then
      v_account := app.partner_account((e ->> 'partner_id')::uuid, e ->> 'account');
    else
      select id into v_account from public.ledger_accounts
       where partner_id is null and code = e ->> 'account' and currency = 'INR' and enabled;
    end if;
    if v_account is null then
      perform app.fail('INTERNAL_ERROR', jsonb_build_object('reason', 'ledger_account_missing', 'account', e ->> 'account'));
    end if;
    insert into public.ledger_entries (journal_id, account_id, side, amount_paise)
    values (v_id, v_account, e ->> 'side', (e ->> 'amount_paise')::bigint);
  end loop;
  return v_id;
end;
$$;

-- What the booking still holds in customer liability (captures less refunds due and earnings).
create or replace function app.booking_liability_balance(p_booking_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when e.side = 'CREDIT' then e.amount_paise else -e.amount_paise end), 0)::bigint
  from public.ledger_journals j
  join public.ledger_entries e on e.journal_id = j.id
  join public.ledger_accounts a on a.id = e.account_id
  where j.booking_id = p_booking_id and a.partner_id is null and a.code = 'CUSTOMER_BOOKING_LIABILITY';
$$;

-- Posted partner payable (credit balance). Negative after a partner-charged refund larger than what is unpaid.
create or replace function app.partner_payable_balance(p_partner_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when e.side = 'CREDIT' then e.amount_paise else -e.amount_paise end), 0)::bigint
  from public.ledger_accounts a
  join public.ledger_entries e on e.account_id = a.id
  where a.partner_id = p_partner_id and a.code = 'PARTNER_PAYABLE';
$$;

-- Serialises everything that reads or moves a partner's payable: payout approval/marking and partner-charged refunds.
create or replace function app.lock_partner_payable(p_partner_id uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('partner_payable:' || p_partner_id::text, 0));
$$;

create or replace function app.require_finance()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.require_platform_admin(array['FINANCE', 'SUPERADMIN']);
$$;

create or replace function app.finance_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.has_platform_role(array['SUPERADMIN']) then 'SUPERADMIN' else 'FINANCE' end;
$$;

-- Earnings ------------------------------------------------------------------------------------------------------------
create or replace function app.booking_earnable(p_booking public.bookings, p_now timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_booking.status in ('COMPLETED', 'CANCELLED') or (p_booking.status = 'NO_SHOW' and p_booking.end_at <= p_now))
     and exists (select 1 from public.payment_attempts a where a.booking_id = p_booking.id and a.allocation_state = 'BOOKING');
$$;

-- Recognises what a finished booking earned: whatever is left in its customer liability, split by its own price
-- snapshot. Idempotent. The caller holds the booking row lock. Returns null when the booking is not finished.
create or replace function app.recognize_booking_earning(p_booking public.bookings, p_now timestamptz)
returns public.booking_earnings
language plpgsql
set search_path = ''
as $$
declare
  v_row public.booking_earnings;
  v_partner uuid;
  v_gross bigint;
  v_fee bigint;
  v_bps integer := coalesce((p_booking.price_snapshot ->> 'commission_bps')::integer, 0);
  v_fixed bigint := coalesce((p_booking.price_snapshot ->> 'platform_fixed_paise')::bigint, 0);
  v_journal uuid;
begin
  select * into v_row from public.booking_earnings where booking_id = p_booking.id;
  if found then
    return v_row;
  end if;
  if not app.booking_earnable(p_booking, p_now) then
    return null;
  end if;
  select partner_id into v_partner from public.venues where id = p_booking.venue_id;
  v_gross := greatest(app.booking_liability_balance(p_booking.id), 0);
  v_fee := case when v_gross = 0 then 0 else least(v_gross, app.div_half_up(v_gross * v_bps, 10000) + v_fixed) end;
  if v_gross > 0 then
    v_journal := app.post_journal('earned:booking:' || p_booking.id, 'BOOKING_EARNED', p_booking.id, null, null,
      'booking:' || p_booking.id || ':' || lower(p_booking.status),
      jsonb_build_array(jsonb_build_object('account', 'CUSTOMER_BOOKING_LIABILITY', 'side', 'DEBIT', 'amount_paise', v_gross))
      || case when v_gross - v_fee > 0 then jsonb_build_array(jsonb_build_object(
           'account', 'PARTNER_PAYABLE', 'partner_id', v_partner, 'side', 'CREDIT', 'amount_paise', v_gross - v_fee))
         else '[]'::jsonb end
      || case when v_fee > 0 then jsonb_build_array(jsonb_build_object(
           'account', 'PLATFORM_FEE_REVENUE', 'side', 'CREDIT', 'amount_paise', v_fee))
         else '[]'::jsonb end);
  end if;
  insert into public.booking_earnings (booking_id, venue_id, partner_id, booking_status, gross_paise, platform_fee_paise,
                                       partner_paise, commission_bps, platform_fixed_paise, fee_config_version, journal_id,
                                       earned_at)
  values (p_booking.id, p_booking.venue_id, v_partner, p_booking.status, v_gross, v_fee, v_gross - v_fee, v_bps, v_fixed,
          coalesce(p_booking.price_snapshot ->> 'fee_config_version', 'UNKNOWN'), v_journal, p_now)
  returning * into v_row;
  return v_row;
end;
$$;

-- Worker sweep. Bookings another transaction holds are skipped and picked up on a later tick.
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
    select b.* from public.bookings b
    where b.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW')
      and (b.status <> 'NO_SHOW' or b.end_at <= v_now)
      and (p_partner_id is null or b.venue_id in (select v.id from public.venues v where v.partner_id = p_partner_id))
      and not exists (select 1 from public.booking_earnings e where e.booking_id = b.id)
      and exists (select 1 from public.payment_attempts a where a.booking_id = b.id and a.allocation_state = 'BOOKING')
    order by b.updated_at
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

-- Admin refunds (A03/A05) ------------------------------------------------------------------------------------------
create or replace function app.refundable_attempts(p_booking_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_attempt_id', a.id, 'allocation', a.allocation_state, 'captured_paise', a.amount_paise,
           'reserved_paise', r.reserved, 'refundable_paise', a.amount_paise - r.reserved)
         order by a.created_at), '[]'::jsonb)
  from public.payment_attempts a
  cross join lateral (select coalesce(sum(f.amount_paise), 0)::bigint as reserved from public.refunds f
                      where f.payment_attempt_id = a.id and f.status <> 'FAILED') r
  where a.booking_id = p_booking_id and a.state = 'CAPTURED' and a.allocation_state in ('BOOKING', 'EXTENSION');
$$;

create or replace function app.admin_refund_options(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_earning public.booking_earnings;
  v_attempts jsonb;
  v_max bigint;
  v_liability bigint;
  v_earnable boolean;
begin
  perform app.require_finance();
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  select * into v_earning from public.booking_earnings where booking_id = p_booking_id;
  v_attempts := app.refundable_attempts(p_booking_id);
  select coalesce(max((x ->> 'refundable_paise')::bigint), 0) into v_max from jsonb_array_elements(v_attempts) x;
  v_liability := app.booking_liability_balance(p_booking_id);
  v_earnable := v_earning.id is not null or app.booking_earnable(v_booking, clock_timestamp());
  return jsonb_build_object(
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'attempts', v_attempts,
    'booking_liability_paise', v_liability,
    'earned', case when v_earning.id is null then null else jsonb_build_object(
      'gross_paise', v_earning.gross_paise, 'platform_fee_paise', v_earning.platform_fee_paise,
      'partner_paise', v_earning.partner_paise, 'earned_at', v_earning.earned_at) end,
    -- Finished bookings are charged to the partner or the platform; earlier refunds come out of the booking itself.
    'needs_charge_to', v_earnable,
    'max_refund_paise', case when v_earnable then v_max else least(v_max, greatest(v_liability, 0)) end);
end;
$$;

create or replace function app.admin_refund(
  p_booking_id uuid, p_amount_paise bigint, p_charge_to text, p_reason text, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz;
  v_booking public.bookings;
  v_earning public.booking_earnings;
  v_charge text;
  v_attempt public.payment_attempts;
  v_refundable bigint;
  v_liability bigint;
  v_partner uuid;
  v_refund public.refunds;
begin
  if p_amount_paise is null or p_amount_paise <= 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'amount_paise'));
  end if;
  if char_length(v_reason) not between 10 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  if p_charge_to is not null and p_charge_to not in ('PARTNER', 'PLATFORM') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'charge_to'));
  end if;
  v_now := app.lock_booking(p_booking_id);
  select * into v_booking from public.bookings where id = p_booking_id;
  if not exists (select 1 from public.payment_attempts where booking_id = p_booking_id and allocation_state = 'BOOKING') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'booking_not_paid', 'status', v_booking.status));
  end if;
  -- A finished booking is recognised first, so the refund is charged against the right account.
  v_earning := app.recognize_booking_earning(v_booking, v_now);
  if v_earning.id is null then
    v_charge := 'BOOKING';
    v_liability := app.booking_liability_balance(p_booking_id);
    if p_amount_paise > v_liability then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'amount_paise', 'reason', 'exceeds_refundable',
                                                               'max_paise', greatest(v_liability, 0)));
    end if;
  else
    if p_charge_to is null then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'charge_to', 'reason', 'required_after_earning'));
    end if;
    v_charge := p_charge_to;
  end if;

  select a.* into v_attempt from public.payment_attempts a
   where a.booking_id = p_booking_id and a.state = 'CAPTURED' and a.allocation_state in ('BOOKING', 'EXTENSION')
   order by a.amount_paise - (select coalesce(sum(f.amount_paise), 0) from public.refunds f
                               where f.payment_attempt_id = a.id and f.status <> 'FAILED') desc, a.created_at
   limit 1
   for update;
  v_refundable := v_attempt.amount_paise - (select coalesce(sum(f.amount_paise), 0) from public.refunds f
                                             where f.payment_attempt_id = v_attempt.id and f.status <> 'FAILED');
  if p_amount_paise > v_refundable then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'amount_paise', 'reason', 'exceeds_refundable',
                                                             'max_paise', v_refundable));
  end if;
  if v_charge = 'PARTNER' then
    select partner_id into v_partner from public.venues where id = v_booking.venue_id;
    perform app.lock_partner_payable(v_partner);
  end if;

  insert into public.refunds (payment_attempt_id, booking_id, amount_paise, currency, reason_code, operation_key, requested_by,
                              approved_by, charge_to, admin_reason)
  values (v_attempt.id, p_booking_id, p_amount_paise, 'INR', 'ADMIN_REFUND',
          'refund:admin:' || coalesce(p_request_id, gen_random_uuid()), v_actor, v_actor, v_charge, v_reason)
  returning * into v_refund;
  perform app.post_journal('admin_refund:' || v_refund.id, 'ADMIN_REFUND_DUE', p_booking_id, v_attempt.id, v_refund.id,
    'admin_refund:' || v_refund.id, jsonb_build_array(
      case v_charge
        when 'BOOKING' then jsonb_build_object('account', 'CUSTOMER_BOOKING_LIABILITY', 'side', 'DEBIT', 'amount_paise', p_amount_paise)
        when 'PARTNER' then jsonb_build_object('account', 'PARTNER_PAYABLE', 'partner_id', v_partner, 'side', 'DEBIT',
                                               'amount_paise', p_amount_paise)
        else jsonb_build_object('account', 'PLATFORM_ADJUSTMENT_EXPENSE', 'side', 'DEBIT', 'amount_paise', p_amount_paise) end,
      jsonb_build_object('account', 'CUSTOMER_REFUND_LIABILITY', 'side', 'CREDIT', 'amount_paise', p_amount_paise)));
  perform app.enqueue_job('refund:' || v_refund.id || ':submit', 'refund.submit', jsonb_build_object('refund_id', v_refund.id));
  perform app.enqueue_job('refund:' || v_refund.id || ':requested', 'refund.requested',
                          jsonb_build_object('booking_id', p_booking_id, 'refund_id', v_refund.id));
  insert into public.booking_events (booking_id, actor_id, event_type, reason_code, request_id, business_key, safe_metadata)
  values (p_booking_id, v_actor, 'ADMIN_REFUND', 'ADMIN_REFUND', p_request_id, 'refund:' || v_refund.id || ':admin',
          jsonb_build_object('refund_id', v_refund.id, 'amount_paise', p_amount_paise, 'charge_to', v_charge));
  perform app.audit(v_actor, app.finance_role(), 'refund.admin_requested', 'refund', v_refund.id, v_booking.venue_id,
                    p_request_id, v_reason,
                    jsonb_build_object('booking_id', p_booking_id, 'amount_paise', p_amount_paise, 'charge_to', v_charge));
  return jsonb_build_object('refund_id', v_refund.id, 'booking_id', p_booking_id, 'status', v_refund.status,
                            'amount_paise', p_amount_paise, 'charge_to', v_charge);
end;
$$;

-- Fee versions (A05) ------------------------------------------------------------------------------------------------
create or replace function app.fee_config_json(p_fee public.fee_configurations, p_actor uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('fee_config_id', p_fee.id, 'config_version', p_fee.config_version, 'status', p_fee.status,
                            'commission_bps', p_fee.commission_bps, 'platform_fixed_paise', p_fee.platform_fixed_paise,
                            'customer_fee_paise', p_fee.customer_fee_paise, 'effective_from', p_fee.effective_from,
                            'is_synthetic', p_fee.is_synthetic, 'created_by_me', p_fee.created_by = p_actor,
                            'approved_at', p_fee.approved_at, 'version', p_fee.version);
$$;

create or replace function app.admin_create_fee_config(
  p_config_version text, p_commission_bps integer, p_platform_fixed_paise bigint, p_customer_fee_paise bigint,
  p_effective_from timestamptz, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_fee public.fee_configurations;
begin
  if p_config_version is null or p_config_version !~ '^[A-Z0-9][A-Z0-9._-]{2,59}$' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'config_version'));
  end if;
  if p_commission_bps is null or p_commission_bps not between 0 and 10000 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'commission_bps'));
  end if;
  if p_platform_fixed_paise is null or p_platform_fixed_paise not between 0 and 1000000 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'platform_fixed_paise'));
  end if;
  if p_customer_fee_paise is null or p_customer_fee_paise not between 0 and 1000000 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'customer_fee_paise'));
  end if;
  -- Dated in the future: existing rates and booking snapshots never change retroactively.
  if p_effective_from is null or p_effective_from <= clock_timestamp() then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'effective_from', 'reason', 'must_be_future'));
  end if;
  if exists (select 1 from public.fee_configurations where config_version = p_config_version) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'config_version', 'reason', 'taken'));
  end if;
  insert into public.fee_configurations (config_version, status, commission_bps, platform_fixed_paise, customer_fee_paise,
                                         effective_from, created_by)
  values (p_config_version, 'DRAFT', p_commission_bps, p_platform_fixed_paise, p_customer_fee_paise, p_effective_from, v_actor)
  returning * into v_fee;
  perform app.audit(v_actor, app.finance_role(), 'fee_config.created', 'fee_configuration', v_fee.id, null, p_request_id, null,
                    jsonb_build_object('config_version', v_fee.config_version, 'commission_bps', v_fee.commission_bps,
                                       'platform_fixed_paise', v_fee.platform_fixed_paise, 'effective_from', v_fee.effective_from));
  return app.fee_config_json(v_fee, v_actor);
end;
$$;

create or replace function app.admin_approve_fee_config(p_fee_config_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_fee public.fee_configurations;
begin
  select * into v_fee from public.fee_configurations where id = p_fee_config_id for update;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  if v_fee.status <> 'DRAFT' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_fee.status));
  end if;
  if v_fee.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_fee.version));
  end if;
  if v_fee.created_by is null or v_fee.created_by = v_actor then
    perform app.fail('SEPARATION_OF_DUTIES');
  end if;
  if v_fee.effective_from <= clock_timestamp() then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'effective_from', 'reason', 'effective_from_passed'));
  end if;
  update public.fee_configurations set status = 'APPROVED', approved_by = v_actor, approved_at = clock_timestamp()
   where id = p_fee_config_id returning * into v_fee;
  perform app.audit(v_actor, app.finance_role(), 'fee_config.approved', 'fee_configuration', v_fee.id, null, p_request_id, null,
                    jsonb_build_object('config_version', v_fee.config_version));
  return app.fee_config_json(v_fee, v_actor);
end;
$$;

-- Reconciliation -------------------------------------------------------------------------------------------------------
create or replace function app.reconciliation_run_json(p_run public.reconciliation_runs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'run_id', p_run.id, 'provider', p_run.provider, 'environment', p_run.environment, 'period_from', p_run.period_from,
    'period_to', p_run.period_to, 'status', p_run.status, 'exception_count', p_run.exception_count,
    'provider_captures', p_run.provider_captures, 'provider_captured_paise', p_run.provider_captured_paise,
    'local_captures', p_run.local_captures, 'local_captured_paise', p_run.local_captured_paise,
    'provider_refunds', p_run.provider_refunds, 'provider_refunded_paise', p_run.provider_refunded_paise,
    'local_refunds', p_run.local_refunds, 'local_refunded_paise', p_run.local_refunded_paise,
    'error_code', p_run.error_code, 'started_at', p_run.started_at, 'completed_at', p_run.completed_at);
$$;

-- Finance starts a run; the server then fetches the provider's records and completes it as the worker role, so
-- provider evidence never comes from a client.
create or replace function app.begin_reconciliation(
  p_from timestamptz, p_to timestamptz, p_provider text, p_environment text, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_now timestamptz := clock_timestamp();
  v_run public.reconciliation_runs;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '31 days' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'period'));
  end if;
  if p_to > v_now + interval '1 minute' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'period', 'reason', 'future'));
  end if;
  update public.reconciliation_runs set status = 'FAILED', error_code = 'ABANDONED', completed_at = v_now
   where status = 'RUNNING' and started_at < v_now - interval '10 minutes';
  insert into public.reconciliation_runs (provider, environment, period_from, period_to, requested_by)
  values (p_provider, p_environment, p_from, least(p_to, v_now), v_actor)
  returning * into v_run;
  perform app.audit(v_actor, app.finance_role(), 'reconciliation.started', 'reconciliation_run', v_run.id, null, p_request_id,
                    null, jsonb_build_object('period_from', v_run.period_from, 'period_to', v_run.period_to));
  return app.reconciliation_run_json(v_run);
end;
$$;

-- Provider lists are fetched for a padded window, so a record whose provider and local timestamps straddle the edge
-- is never reported missing. Captures: [{provider_payment_id, amount_paise, captured_at}]; refunds:
-- [{provider_refund_id, provider_payment_id, amount_paise, state, created_at}].
create or replace function app.complete_reconciliation(p_run_id uuid, p_captures jsonb, p_refunds jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.reconciliation_runs;
  v_count integer;
begin
  select * into v_run from public.reconciliation_runs where id = p_run_id for update;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  if v_run.status <> 'RUNNING' then
    return app.reconciliation_run_json(v_run);
  end if;

  -- Provider captures in the period that are missing, uncaptured or different locally.
  insert into public.reconciliation_exceptions (run_id, kind, object_type, provider_ref, local_id, booking_id,
                                                provider_amount_paise, local_amount_paise)
  select p_run_id,
         case when a.id is null then 'MISSING_LOCALLY' when a.state <> 'CAPTURED' then 'STATE_MISMATCH' else 'AMOUNT_MISMATCH' end,
         'PAYMENT', p.pid, a.id, a.booking_id, p.amount, a.amount_paise
  from (select x ->> 'provider_payment_id' as pid, (x ->> 'amount_paise')::bigint as amount, (x ->> 'captured_at')::timestamptz as at
        from jsonb_array_elements(p_captures) x) p
  left join public.payment_attempts a
    on a.provider = v_run.provider and a.environment = v_run.environment and a.provider_payment_id = p.pid
  where p.at >= v_run.period_from and p.at < v_run.period_to
    and (a.id is null or a.state <> 'CAPTURED' or a.amount_paise <> p.amount);

  -- Local captures in the period the provider does not have.
  insert into public.reconciliation_exceptions (run_id, kind, object_type, provider_ref, local_id, booking_id, local_amount_paise)
  select p_run_id, 'MISSING_AT_PROVIDER', 'PAYMENT', a.provider_payment_id, a.id, a.booking_id, a.amount_paise
  from public.payment_attempts a
  where a.provider = v_run.provider and a.environment = v_run.environment and a.state = 'CAPTURED'
    and a.captured_at >= v_run.period_from and a.captured_at < v_run.period_to
    and not exists (select 1 from jsonb_array_elements(p_captures) x where x ->> 'provider_payment_id' = a.provider_payment_id);

  -- Local captures the ledger never recorded.
  insert into public.reconciliation_exceptions (run_id, kind, object_type, provider_ref, local_id, booking_id, local_amount_paise)
  select p_run_id, 'LEDGER_MISSING', 'PAYMENT', a.provider_payment_id, a.id, a.booking_id, a.amount_paise
  from public.payment_attempts a
  where a.provider = v_run.provider and a.environment = v_run.environment and a.state = 'CAPTURED'
    and a.currency = 'INR' and a.amount_paise > 0
    and a.captured_at >= v_run.period_from and a.captured_at < v_run.period_to
    and not exists (select 1 from public.ledger_journals j
                    where j.payment_attempt_id = a.id
                      and j.kind in ('CAPTURE_ALLOCATED_BOOKING', 'CAPTURE_ALLOCATED_EXTENSION', 'CAPTURE_REFUND_DUE',
                                     'CAPTURE_QUARANTINED'));

  -- Provider refunds in the period that are missing, unprocessed or different locally.
  insert into public.reconciliation_exceptions (run_id, kind, object_type, provider_ref, local_id, booking_id,
                                                provider_amount_paise, local_amount_paise)
  select p_run_id,
         case when f.id is null then 'MISSING_LOCALLY' when f.status <> 'PROCESSED' then 'STATE_MISMATCH' else 'AMOUNT_MISMATCH' end,
         'REFUND', p.rid, f.id, f.booking_id, p.amount, f.amount_paise
  from (select x ->> 'provider_refund_id' as rid, (x ->> 'amount_paise')::bigint as amount, (x ->> 'created_at')::timestamptz as at
        from jsonb_array_elements(p_refunds) x where x ->> 'state' = 'PROCESSED') p
  left join public.refunds f on f.provider_refund_id = p.rid
  where p.at >= v_run.period_from and p.at < v_run.period_to
    and (f.id is null or f.status <> 'PROCESSED' or f.amount_paise <> p.amount);

  -- Local processed refunds the provider does not have, or the ledger never recorded.
  insert into public.reconciliation_exceptions (run_id, kind, object_type, provider_ref, local_id, booking_id, local_amount_paise)
  select p_run_id, k.kind, 'REFUND', f.provider_refund_id, f.id, f.booking_id, f.amount_paise
  from public.refunds f
  join public.payment_attempts a on a.id = f.payment_attempt_id
  cross join lateral (
    select 'MISSING_AT_PROVIDER' as kind
     where not exists (select 1 from jsonb_array_elements(p_refunds) x where x ->> 'provider_refund_id' = f.provider_refund_id)
    union all
    select 'LEDGER_MISSING'
     where not exists (select 1 from public.ledger_journals j where j.refund_id = f.id and j.kind = 'REFUND_PROCESSED')
  ) k
  where a.provider = v_run.provider and a.environment = v_run.environment and f.status = 'PROCESSED'
    and f.processed_at >= v_run.period_from and f.processed_at < v_run.period_to;

  select count(*) into v_count from public.reconciliation_exceptions where run_id = p_run_id;
  update public.reconciliation_runs r set
    provider_captures = c.n, provider_captured_paise = c.amount,
    local_captures = lc.n, local_captured_paise = lc.amount,
    provider_refunds = rf.n, provider_refunded_paise = rf.amount,
    local_refunds = lr.n, local_refunded_paise = lr.amount,
    exception_count = v_count,
    status = case when v_count > 0 then 'MISMATCH' else 'MATCHED' end,
    completed_at = clock_timestamp()
  from (select count(*)::integer as n, coalesce(sum((x ->> 'amount_paise')::bigint), 0)::bigint as amount
        from jsonb_array_elements(p_captures) x
        where (x ->> 'captured_at')::timestamptz >= v_run.period_from and (x ->> 'captured_at')::timestamptz < v_run.period_to) c,
       (select count(*)::integer as n, coalesce(sum(a.amount_paise), 0)::bigint as amount from public.payment_attempts a
        where a.provider = v_run.provider and a.environment = v_run.environment and a.state = 'CAPTURED'
          and a.captured_at >= v_run.period_from and a.captured_at < v_run.period_to) lc,
       (select count(*)::integer as n, coalesce(sum((x ->> 'amount_paise')::bigint), 0)::bigint as amount
        from jsonb_array_elements(p_refunds) x
        where x ->> 'state' = 'PROCESSED'
          and (x ->> 'created_at')::timestamptz >= v_run.period_from and (x ->> 'created_at')::timestamptz < v_run.period_to) rf,
       (select count(*)::integer as n, coalesce(sum(f.amount_paise), 0)::bigint as amount from public.refunds f
        join public.payment_attempts a on a.id = f.payment_attempt_id
        where a.provider = v_run.provider and a.environment = v_run.environment and f.status = 'PROCESSED'
          and f.processed_at >= v_run.period_from and f.processed_at < v_run.period_to) lr
  where r.id = p_run_id
  returning r.* into v_run;
  if v_run.status = 'MISMATCH' then
    insert into public.audit_events (actor_role, action, entity_type, entity_id, reason, safe_diff)
    values ('SERVICE', 'reconciliation.mismatch', 'reconciliation_run', v_run.id, 'exceptions found',
            jsonb_build_object('exception_count', v_count));
  end if;
  return app.reconciliation_run_json(v_run);
end;
$$;

create or replace function app.fail_reconciliation(p_run_id uuid, p_error_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.reconciliation_runs;
begin
  update public.reconciliation_runs set status = 'FAILED', error_code = left(coalesce(p_error_code, 'ERROR'), 60),
                                        completed_at = clock_timestamp()
   where id = p_run_id and status = 'RUNNING' returning * into v_run;
  if not found then
    select * into v_run from public.reconciliation_runs where id = p_run_id;
  end if;
  return app.reconciliation_run_json(v_run);
end;
$$;

create or replace function app.admin_reconciliation_run(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run public.reconciliation_runs;
begin
  perform app.require_finance();
  select * into v_run from public.reconciliation_runs where id = p_run_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  return app.reconciliation_run_json(v_run) || jsonb_build_object(
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object(
                              'kind', x.kind, 'object_type', x.object_type, 'provider_ref', x.provider_ref,
                              'local_id', x.local_id, 'booking_id', x.booking_id, 'public_ref', b.public_ref,
                              'provider_amount_paise', x.provider_amount_paise, 'local_amount_paise', x.local_amount_paise)
                            order by x.created_at, x.id)
                            from (select * from public.reconciliation_exceptions where run_id = p_run_id
                                  order by created_at, id limit 200) x
                            left join public.bookings b on b.id = x.booking_id), '[]'::jsonb));
end;
$$;

-- Payouts --------------------------------------------------------------------------------------------------------------
create or replace function app.new_payout_ref()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'PO-' || string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 31) + 1, 1), '')
  from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) as i;
$$;

create or replace function app.payout_batch_json(p_batch public.payout_batches, p_actor uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'payout_batch_id', p_batch.id, 'public_ref', p_batch.public_ref, 'partner_id', p_batch.partner_id,
    'partner_name', (select display_name from public.partners where id = p_batch.partner_id),
    'status', p_batch.status, 'amount_paise', p_batch.amount_paise, 'earnings_paise', p_batch.earnings_paise,
    'adjustments_paise', p_batch.adjustments_paise, 'period_start', p_batch.period_start, 'period_end', p_batch.period_end,
    'items', (select count(*) from public.payout_allocations where batch_id = p_batch.id),
    'created_by_me', p_batch.created_by = p_actor, 'approved_at', p_batch.approved_at,
    'reconciliation_run_id', p_batch.reconciliation_run_id, 'transfer_ref', p_batch.transfer_ref,
    'evidence_ref', p_batch.evidence_ref, 'paid_at', p_batch.paid_at, 'status_reason', p_batch.status_reason,
    'created_at', p_batch.created_at, 'version', p_batch.version);
$$;

-- Drafts a payout of everything available for the partner: unallocated earnings less unallocated partner-charged
-- refunds. A net of zero or less is carried forward, never paid.
create or replace function app.create_payout_batch(p_partner_id uuid, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_earnings bigint;
  v_adjustments bigint;
  v_start timestamptz;
  v_end timestamptz;
  v_batch public.payout_batches;
begin
  if not exists (select 1 from public.partners where id = p_partner_id) then
    perform app.fail('NOT_FOUND');
  end if;
  -- Finished bookings not yet swept are recognised first (booking locks before the partner lock).
  perform app.recognize_earnings(500, p_partner_id);
  perform app.lock_partner_payable(p_partner_id);
  if exists (select 1 from public.payout_batches where partner_id = p_partner_id and status in ('DRAFT', 'APPROVED', 'PROCESSING')) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'open_batch'));
  end if;

  create temporary table payout_items on commit drop as
  select 'EARNING'::text as kind, e.id as earning_id, null::uuid as refund_id, e.booking_id, e.venue_id,
         e.partner_paise as amount, e.earned_at as at
  from public.booking_earnings e
  where e.partner_id = p_partner_id and e.partner_paise > 0
    and not exists (select 1 from public.payout_allocations x where x.booking_earning_id = e.id and x.active)
  union all
  select 'ADJUSTMENT', null, f.id, f.booking_id, b.venue_id, -f.amount_paise, f.created_at
  from public.refunds f
  join public.bookings b on b.id = f.booking_id
  join public.venues v on v.id = b.venue_id
  where v.partner_id = p_partner_id and f.charge_to = 'PARTNER'
    and not exists (select 1 from public.payout_allocations x where x.refund_id = f.id and x.active);

  select coalesce(sum(amount) filter (where kind = 'EARNING'), 0), coalesce(-sum(amount) filter (where kind = 'ADJUSTMENT'), 0),
         max(at)
    into v_earnings, v_adjustments, v_end
  from pg_temp.payout_items;
  if v_earnings - v_adjustments <= 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'nothing_payable', 'net_paise', v_earnings - v_adjustments));
  end if;
  -- Reconciliation must cover every capture behind the batch, through its latest item.
  select least(min(a.captured_at), min(i.at)) into v_start
  from pg_temp.payout_items i
  left join public.payment_attempts a on a.booking_id = i.booking_id and a.allocation_state in ('BOOKING', 'EXTENSION');

  insert into public.payout_batches (public_ref, partner_id, amount_paise, earnings_paise, adjustments_paise, period_start,
                                     period_end, created_by)
  values (app.new_payout_ref(), p_partner_id, v_earnings - v_adjustments, v_earnings, v_adjustments, v_start, v_end, v_actor)
  returning * into v_batch;
  insert into public.payout_allocations (batch_id, partner_id, venue_id, booking_id, kind, booking_earning_id, refund_id, amount_paise)
  select v_batch.id, p_partner_id, venue_id, booking_id, kind, earning_id, refund_id, amount from pg_temp.payout_items;
  drop table pg_temp.payout_items;
  perform app.audit(v_actor, app.finance_role(), 'payout.drafted', 'payout_batch', v_batch.id, null, p_request_id, null,
                    jsonb_build_object('partner_id', p_partner_id, 'amount_paise', v_batch.amount_paise,
                                       'adjustments_paise', v_adjustments));
  return app.payout_batch_json(v_batch, v_actor);
end;
$$;

create or replace function app.approve_payout_batch(p_batch_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_batch public.payout_batches;
  v_run public.reconciliation_runs;
  v_available bigint;
begin
  select * into v_batch from public.payout_batches where id = p_batch_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.lock_partner_payable(v_batch.partner_id);
  select * into v_batch from public.payout_batches where id = p_batch_id for update;
  if v_batch.status <> 'DRAFT' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_batch.status));
  end if;
  if v_batch.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_batch.version));
  end if;
  if v_batch.created_by = v_actor then
    perform app.fail('SEPARATION_OF_DUTIES');
  end if;
  -- The latest completed run touching the batch period decides: it must be MATCHED and cover the whole period.
  select * into v_run from public.reconciliation_runs
   where status in ('MATCHED', 'MISMATCH') and period_from <= v_batch.period_end and period_to >= v_batch.period_start
   order by completed_at desc limit 1;
  if v_run.id is null or v_run.status <> 'MATCHED' or v_run.period_from > v_batch.period_start
     or v_run.period_to <= v_batch.period_end then
    perform app.fail('RECONCILIATION_REQUIRED', jsonb_build_object(
      'latest_run_id', v_run.id, 'latest_status', v_run.status,
      'needed_from', v_batch.period_start, 'needed_to', v_batch.period_end));
  end if;
  -- Available payable re-checked under the partner lock: refunds charged since the draft may have reduced it.
  v_available := app.partner_payable_balance(v_batch.partner_id);
  if v_batch.amount_paise > v_available then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'payable_changed', 'available_paise', v_available));
  end if;
  update public.payout_batches set status = 'APPROVED', approved_by = v_actor, approved_at = clock_timestamp(),
                                   reconciliation_run_id = v_run.id
   where id = p_batch_id returning * into v_batch;
  perform app.audit(v_actor, app.finance_role(), 'payout.approved', 'payout_batch', v_batch.id, null, p_request_id, null,
                    jsonb_build_object('amount_paise', v_batch.amount_paise, 'reconciliation_run_id', v_run.id));
  return app.payout_batch_json(v_batch, v_actor);
end;
$$;

-- PROCESSING (transfer started, optional transfer reference), PAID (evidence required; posts the payout journal),
-- FAILED (releases allocations back to available), CANCELLED (drafts only).
create or replace function app.mark_payout_batch(
  p_batch_id uuid, p_status text, p_expected_version integer, p_reference text, p_reason text, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_batch public.payout_batches;
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_journal uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_status not in ('PROCESSING', 'PAID', 'FAILED', 'CANCELLED') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'status'));
  end if;
  if v_reference is not null and v_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,119}$' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reference'));
  end if;
  if p_status = 'PAID' and v_reference is null then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reference', 'reason', 'evidence_required'));
  end if;
  if p_status in ('FAILED', 'CANCELLED') and (v_reason is null or char_length(v_reason) not between 3 and 500) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  select * into v_batch from public.payout_batches where id = p_batch_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.lock_partner_payable(v_batch.partner_id);
  select * into v_batch from public.payout_batches where id = p_batch_id for update;
  if v_batch.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_batch.version, 'status', v_batch.status));
  end if;
  if not ((p_status = 'CANCELLED' and v_batch.status = 'DRAFT')
          or (p_status = 'PROCESSING' and v_batch.status = 'APPROVED')
          or (p_status in ('PAID', 'FAILED') and v_batch.status in ('APPROVED', 'PROCESSING'))) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_batch.status));
  end if;

  if p_status = 'PAID' then
    v_journal := app.post_journal('payout:' || v_batch.id || ':paid', 'PAYOUT_PAID', null, null, null,
      'payout_evidence:' || v_reference, jsonb_build_array(
        jsonb_build_object('account', 'PARTNER_PAYABLE', 'partner_id', v_batch.partner_id, 'side', 'DEBIT',
                           'amount_paise', v_batch.amount_paise),
        jsonb_build_object('account', 'GATEWAY_CLEARING', 'side', 'CREDIT', 'amount_paise', v_batch.amount_paise)));
    update public.payout_batches set status = 'PAID', evidence_ref = v_reference, paid_at = v_now, marked_by = v_actor,
                                     journal_id = v_journal
     where id = p_batch_id returning * into v_batch;
  elsif p_status = 'PROCESSING' then
    update public.payout_batches set status = 'PROCESSING', transfer_ref = v_reference, marked_by = v_actor
     where id = p_batch_id returning * into v_batch;
  else
    update public.payout_allocations set active = false, released_at = v_now where batch_id = p_batch_id and active;
    update public.payout_batches set status = p_status, status_reason = v_reason, marked_by = v_actor
     where id = p_batch_id returning * into v_batch;
  end if;
  perform app.audit(v_actor, app.finance_role(), 'payout.' || lower(p_status), 'payout_batch', v_batch.id, null, p_request_id,
                    v_reason, jsonb_build_object('amount_paise', v_batch.amount_paise, 'reference', v_reference));
  return app.payout_batch_json(v_batch, v_actor);
end;
$$;

-- A05 overview ---------------------------------------------------------------------------------------------------------
create or replace function app.admin_finance_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_now timestamptz := clock_timestamp();
begin
  return jsonb_build_object(
    'actor_id', v_actor,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('code', a.code, 'account_type', a.account_type, 'balance_paise', bal.amount)
                       order by a.code)
      from public.ledger_accounts a
      cross join lateral (
        select coalesce(sum(case when (e.side = 'DEBIT') = (a.account_type in ('ASSET', 'EXPENSE'))
                                 then e.amount_paise else -e.amount_paise end), 0)::bigint as amount
        from public.ledger_entries e where e.account_id = a.id) bal
      where a.partner_id is null), '[]'::jsonb),
    'partner_payable_total_paise', (
      select coalesce(sum(case when e.side = 'CREDIT' then e.amount_paise else -e.amount_paise end), 0)::bigint
      from public.ledger_accounts a join public.ledger_entries e on e.account_id = a.id
      where a.partner_id is not null and a.code = 'PARTNER_PAYABLE'),
    'refunds', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(s.status, jsonb_build_object('count', s.n, 'amount_paise', s.amount))
                             from (select status, count(*) as n, sum(amount_paise)::bigint as amount
                                   from public.refunds group by status) s), '{}'::jsonb),
      'attention', coalesce((
        select jsonb_agg(jsonb_build_object('refund_id', f.id, 'booking_id', f.booking_id, 'public_ref', b.public_ref,
                                            'amount_paise', f.amount_paise, 'reason_code', f.reason_code, 'status', f.status,
                                            'charge_to', f.charge_to, 'last_error_code', f.last_error_code,
                                            'created_at', f.created_at)
                         order by f.created_at)
        from (select * from public.refunds
              where status in ('FAILED', 'UNKNOWN')
                 or (status in ('REQUESTED', 'PROCESSING') and created_at < v_now - interval '15 minutes')
              order by created_at limit 25) f
        join public.bookings b on b.id = f.booking_id), '[]'::jsonb)),
    'reconciliation', coalesce((select jsonb_agg(app.reconciliation_run_json(r) order by r.started_at desc)
                                from (select * from public.reconciliation_runs order by started_at desc limit 10) r), '[]'::jsonb),
    'partners', coalesce((
      select jsonb_agg(item order by (item ->> 'payable_paise')::bigint desc, item ->> 'partner_name')
      from (
        select jsonb_build_object(
          'partner_id', p.id, 'partner_name', p.display_name, 'payout_enabled', p.payout_enabled, 'is_synthetic', p.is_synthetic,
          'payable_paise', app.partner_payable_balance(p.id),
          'unallocated_earnings_paise', (select coalesce(sum(e.partner_paise), 0)::bigint from public.booking_earnings e
                                          where e.partner_id = p.id
                                            and not exists (select 1 from public.payout_allocations x
                                                            where x.booking_earning_id = e.id and x.active)),
          'unallocated_adjustments_paise', (select coalesce(sum(f.amount_paise), 0)::bigint from public.refunds f
                                             join public.bookings b on b.id = f.booking_id
                                             join public.venues v on v.id = b.venue_id
                                             where v.partner_id = p.id and f.charge_to = 'PARTNER'
                                               and not exists (select 1 from public.payout_allocations x
                                                               where x.refund_id = f.id and x.active)),
          'open_batch_id', (select pb.id from public.payout_batches pb
                             where pb.partner_id = p.id and pb.status in ('DRAFT', 'APPROVED', 'PROCESSING'))) as item
        from public.partners p
        where exists (select 1 from public.ledger_accounts a where a.partner_id = p.id)
        order by p.created_at desc
        limit 50) t), '[]'::jsonb),
    'payout_batches', coalesce((select jsonb_agg(app.payout_batch_json(pb, v_actor) order by pb.created_at desc)
                                from (select * from public.payout_batches order by created_at desc limit 25) pb), '[]'::jsonb),
    'fee_configs', coalesce((select jsonb_agg(app.fee_config_json(f, v_actor) order by f.effective_from desc, f.created_at desc)
                             from (select * from public.fee_configurations order by effective_from desc, created_at desc
                                   limit 20) f), '[]'::jsonb),
    'server_now', v_now);
end;
$$;

-- P07 partner statement -----------------------------------------------------------------------------------------------
-- Venue-scoped: a manager of one venue never sees another venue's money, even for the same partner. Payout lines show
-- only this venue's share of each batch. Anything not yet in a PAID payout is flagged unresolved.
create or replace function app.partner_statement(p_venue_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_venue public.venues;
  v_start timestamptz;
  v_end timestamptz;
  v_earnings jsonb;
  v_adjustments jsonb;
  v_payouts jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'period'));
  end if;
  select * into v_venue from public.venues where id = p_venue_id;
  v_start := (p_from::timestamp) at time zone v_venue.timezone;
  v_end := ((p_to + 1)::timestamp) at time zone v_venue.timezone;

  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_id', e.booking_id, 'public_ref', b.public_ref, 'start_at', b.start_at, 'booking_status', e.booking_status,
           'gross_paise', e.gross_paise, 'platform_fee_paise', e.platform_fee_paise, 'partner_paise', e.partner_paise,
           'earned_at', e.earned_at, 'payout_ref', pb.public_ref, 'payout_status', coalesce(pb.status, 'UNPAID'))
         order by e.earned_at, b.public_ref), '[]'::jsonb)
    into v_earnings
  from public.booking_earnings e
  join public.bookings b on b.id = e.booking_id
  left join public.payout_allocations x on x.booking_earning_id = e.id and x.active
  left join public.payout_batches pb on pb.id = x.batch_id
  where e.venue_id = p_venue_id and e.earned_at >= v_start and e.earned_at < v_end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'refund_id', f.id, 'booking_id', f.booking_id, 'public_ref', b.public_ref, 'amount_paise', f.amount_paise,
           'refund_status', f.status, 'created_at', f.created_at, 'payout_ref', pb.public_ref,
           'payout_status', coalesce(pb.status, 'UNPAID'))
         order by f.created_at), '[]'::jsonb)
    into v_adjustments
  from public.refunds f
  join public.bookings b on b.id = f.booking_id
  left join public.payout_allocations x on x.refund_id = f.id and x.active
  left join public.payout_batches pb on pb.id = x.batch_id
  where b.venue_id = p_venue_id and f.charge_to = 'PARTNER' and f.created_at >= v_start and f.created_at < v_end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'public_ref', s.public_ref, 'status', s.status, 'venue_amount_paise', s.venue_amount, 'created_at', s.created_at,
           'paid_at', s.paid_at, 'evidence_ref', case when s.status = 'PAID' then s.evidence_ref end)
         order by s.created_at), '[]'::jsonb)
    into v_payouts
  from (select pb.id, pb.public_ref, pb.status, pb.created_at, pb.paid_at, pb.evidence_ref, sum(x.amount_paise)::bigint as venue_amount
        from public.payout_batches pb
        join public.payout_allocations x on x.batch_id = pb.id and x.venue_id = p_venue_id
        where (pb.created_at >= v_start and pb.created_at < v_end) or (pb.paid_at >= v_start and pb.paid_at < v_end)
        group by pb.id) s;

  return jsonb_build_object(
    'venue', jsonb_build_object('id', v_venue.id, 'name', v_venue.name, 'timezone', v_venue.timezone),
    'from', p_from, 'to', p_to,
    'earnings', v_earnings,
    'adjustments', v_adjustments,
    'payouts', v_payouts,
    'totals', jsonb_build_object(
      'gross_paise', (select coalesce(sum((x ->> 'gross_paise')::bigint), 0) from jsonb_array_elements(v_earnings) x),
      'platform_fee_paise', (select coalesce(sum((x ->> 'platform_fee_paise')::bigint), 0) from jsonb_array_elements(v_earnings) x),
      'earned_paise', (select coalesce(sum((x ->> 'partner_paise')::bigint), 0) from jsonb_array_elements(v_earnings) x),
      'adjustments_paise', (select coalesce(sum((x ->> 'amount_paise')::bigint), 0) from jsonb_array_elements(v_adjustments) x),
      'paid_paise', (select coalesce(sum((x ->> 'partner_paise')::bigint), 0) from jsonb_array_elements(v_earnings) x
                     where x ->> 'payout_status' = 'PAID')
                  - (select coalesce(sum((x ->> 'amount_paise')::bigint), 0) from jsonb_array_elements(v_adjustments) x
                     where x ->> 'payout_status' = 'PAID'),
      'unresolved_paise', (select coalesce(sum((x ->> 'partner_paise')::bigint), 0) from jsonb_array_elements(v_earnings) x
                           where x ->> 'payout_status' <> 'PAID')
                        - (select coalesce(sum((x ->> 'amount_paise')::bigint), 0) from jsonb_array_elements(v_adjustments) x
                           where x ->> 'payout_status' <> 'PAID')),
    -- Paid bookings in the period that have not finished yet: not earnings until they do.
    'not_yet_earned', (select jsonb_build_object('count', count(*), 'captured_paise', coalesce(sum(a.amount_paise), 0)::bigint)
                       from public.bookings b
                       join public.payment_attempts a on a.booking_id = b.id and a.allocation_state in ('BOOKING', 'EXTENSION')
                       where b.venue_id = p_venue_id and b.start_at >= v_start and b.start_at < v_end
                         and not exists (select 1 from public.booking_earnings e where e.booking_id = b.id)),
    'role', case when app.is_venue_member(p_venue_id, array['OWNER']) then 'OWNER' else 'MANAGER' end,
    'generated_at', clock_timestamp());
end;
$$;

grant execute on function
  app.admin_refund_options(uuid),
  app.admin_refund(uuid, bigint, text, text, uuid),
  app.admin_create_fee_config(text, integer, bigint, bigint, timestamptz, uuid),
  app.admin_approve_fee_config(uuid, integer, uuid),
  app.begin_reconciliation(timestamptz, timestamptz, text, text, uuid),
  app.admin_reconciliation_run(uuid),
  app.create_payout_batch(uuid, uuid),
  app.approve_payout_batch(uuid, integer, uuid),
  app.mark_payout_batch(uuid, text, integer, text, text, uuid),
  app.admin_finance_overview(),
  app.partner_statement(uuid, date, date)
  to authenticated;
grant execute on function
  app.recognize_earnings(integer, uuid),
  app.complete_reconciliation(uuid, jsonb, jsonb),
  app.fail_reconciliation(uuid, text)
  to simply_worker;
-- Internal: partner_account, post_journal, booking_liability_balance, partner_payable_balance, lock_partner_payable,
-- require_finance, finance_role, booking_earnable, recognize_booking_earning, refundable_attempts, fee_config_json,
-- reconciliation_run_json, new_payout_ref, payout_batch_json.
revoke execute on all functions in schema app from public;
