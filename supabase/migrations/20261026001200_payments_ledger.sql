-- M3 money records (docs/05 "Money, durable work and support", docs/07 s.7). Booking, order, attempt, allocation and
-- refund states are separate. Payment truth is written only by app.* functions running as the worker role.

-- Booking additions ------------------------------------------------------------------------------------------------
alter table public.bookings
  add column confirmed_at timestamptz,
  add column checkin_pin_hash text,
  add constraint bookings_pin_only_when_confirmed check (checkin_pin_hash is null or status in ('CONFIRMED', 'CHECKED_IN')),
  add constraint bookings_confirmed_codes check (status not in ('CONFIRMED', 'CHECKED_IN') or (checkin_token_hash is not null and checkin_pin_hash is not null));
comment on column public.bookings.checkin_pin_hash is 'SHA-256 of booking id + arrival PIN. Never granted to clients.';

-- Payment orders: the expected payment for one booking hold. One active order per booking. ---------------------------
create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  venue_id uuid not null,
  customer_id uuid not null references public.profiles (id),
  provider text not null check (provider in ('mock')),
  environment text not null check (environment in ('TEST', 'LIVE')),
  provider_order_id text,
  expected_amount_paise bigint not null check (expected_amount_paise > 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  state text not null default 'CREATED' check (state in ('CREATED', 'ORDER_PENDING', 'READY', 'UNKNOWN', 'EXPIRED')),
  operation_key text not null unique check (char_length(operation_key) between 8 and 120),
  attempt_no integer not null check (attempt_no > 0),
  creation_lease_until timestamptz,
  expires_at timestamptz not null,
  reconciled_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (provider, environment, provider_order_id),
  unique (id, provider, environment),
  unique (booking_id, attempt_no),
  constraint payment_orders_booking_fk foreign key (booking_id, venue_id) references public.bookings (id, venue_id),
  constraint payment_orders_ready_ref check (state <> 'READY' or provider_order_id is not null)
);
comment on table public.payment_orders is 'Expected payment for a hold. Provider order identity is not a payment identity; attempts are separate.';
create unique index payment_orders_one_active on public.payment_orders (booking_id)
  where state in ('CREATED', 'ORDER_PENDING', 'READY', 'UNKNOWN');
create index payment_orders_customer_idx on public.payment_orders (customer_id, created_at desc);
create index payment_orders_reconcile_idx on public.payment_orders (state, reconciled_at);
create trigger payment_orders_touch before update on public.payment_orders for each row execute function app.touch_row();

create or replace function app.guard_payment_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'payment_orders'));
  end if;
  if (new.booking_id, new.venue_id, new.customer_id, new.provider, new.environment, new.expected_amount_paise, new.currency,
      new.operation_key, new.attempt_no)
     is distinct from
     (old.booking_id, old.venue_id, old.customer_id, old.provider, old.environment, old.expected_amount_paise, old.currency,
      old.operation_key, old.attempt_no) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'payment_orders', 'reason', 'identity'));
  end if;
  -- A provider order reference, once known, never changes.
  if old.provider_order_id is not null and new.provider_order_id is distinct from old.provider_order_id then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'payment_orders', 'reason', 'provider_order_id'));
  end if;
  if old.state = 'EXPIRED' and new.state <> 'EXPIRED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('from', old.state, 'to', new.state));
  end if;
  return new;
end;
$$;
create trigger payment_orders_guard before update or delete on public.payment_orders
  for each row execute function app.guard_payment_order();

-- Actual provider payments under an order. Never merged: a failed attempt and a later capture are two rows. ------------
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null,
  booking_id uuid not null references public.bookings (id),
  provider text not null,
  environment text not null,
  provider_payment_id text not null check (char_length(provider_payment_id) between 1 and 120),
  amount_paise bigint not null check (amount_paise >= 0),
  currency char(3) not null,
  state text not null default 'PENDING' check (state in ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'UNKNOWN')),
  captured_at timestamptz,
  verified_at timestamptz,
  allocation_state text not null default 'UNALLOCATED' check (allocation_state in (
    'UNALLOCATED', 'BOOKING', 'EXTENSION', 'REFUND_DUE', 'REFUNDED', 'QUARANTINED'
  )),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (provider, environment, provider_payment_id),
  constraint payment_attempts_order_fk foreign key (payment_order_id, provider, environment)
    references public.payment_orders (id, provider, environment),
  constraint payment_attempts_allocation_needs_capture check (allocation_state = 'UNALLOCATED' or state = 'CAPTURED')
);
comment on column public.payment_attempts.allocation_state is 'What the captured money is for. Exactly one BOOKING allocation per booking.';
create unique index payment_attempts_one_booking_allocation on public.payment_attempts (booking_id) where allocation_state = 'BOOKING';
create index payment_attempts_order_state_idx on public.payment_attempts (payment_order_id, state);
create index payment_attempts_booking_idx on public.payment_attempts (booking_id);
create trigger payment_attempts_touch before update on public.payment_attempts for each row execute function app.touch_row();

-- State never regresses (a delayed FAILED cannot undo CAPTURED); allocation moves forward only.
create or replace function app.guard_payment_attempt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'payment_attempts'));
  end if;
  if (new.payment_order_id, new.booking_id, new.provider, new.environment, new.provider_payment_id, new.amount_paise, new.currency)
     is distinct from
     (old.payment_order_id, old.booking_id, old.provider, old.environment, old.provider_payment_id, old.amount_paise, old.currency) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'payment_attempts', 'reason', 'identity'));
  end if;
  if old.state = 'CAPTURED' and new.state <> 'CAPTURED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('from', old.state, 'to', new.state));
  end if;
  if new.allocation_state is distinct from old.allocation_state and not (
    (old.allocation_state = 'UNALLOCATED' and new.allocation_state in ('BOOKING', 'EXTENSION', 'REFUND_DUE', 'QUARANTINED'))
    or (old.allocation_state = 'REFUND_DUE' and new.allocation_state = 'REFUNDED')
    or (old.allocation_state = 'QUARANTINED' and new.allocation_state = 'REFUND_DUE')
  ) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('from', old.allocation_state, 'to', new.allocation_state));
  end if;
  return new;
end;
$$;
create trigger payment_attempts_guard before update or delete on public.payment_attempts
  for each row execute function app.guard_payment_attempt();

-- Append-only observations: every provider fact we saw, from which source (docs/07 s.7 "Preserve observations").
create table public.payment_attempt_events (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid not null references public.payment_attempts (id),
  observed_state text not null check (observed_state in ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'UNKNOWN')),
  amount_paise bigint not null check (amount_paise >= 0),
  currency char(3) not null,
  source text not null check (source in ('VERIFY', 'WEBHOOK', 'RECONCILE')),
  provider_event_id uuid,
  created_at timestamptz not null default now()
);
create index payment_attempt_events_attempt_idx on public.payment_attempt_events (payment_attempt_id, created_at);
create trigger payment_attempt_events_append_only before update or delete on public.payment_attempt_events
  for each row execute function app.forbid_change();

-- Signed provider webhooks, deduplicated by provider event identity. Only allowlisted fields are kept. -----------------
create table public.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null check (environment in ('TEST', 'LIVE')),
  event_id text not null check (char_length(event_id) between 1 and 200),
  event_type text not null check (char_length(event_type) between 1 and 80),
  safe_payload jsonb not null check (jsonb_typeof(safe_payload) = 'object' and pg_column_size(safe_payload) < 4096),
  payload_hash text not null,
  received_at timestamptz not null default now(),
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'PROCESSED', 'RETRY', 'QUARANTINED')),
  attempts integer not null default 0,
  processed_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (provider, environment, event_id)
);
create index provider_events_status_idx on public.provider_events (status, received_at);
create trigger provider_events_touch before update on public.provider_events for each row execute function app.touch_row();

-- Refund liabilities. Under the attempt lock, non-failed refunds never exceed the captured amount. ---------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid not null references public.payment_attempts (id),
  booking_id uuid not null references public.bookings (id),
  amount_paise bigint not null check (amount_paise > 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  reason_code text not null check (reason_code in ('LATE_CAPTURE', 'CANCELLED_HOLD_CAPTURE', 'DUPLICATE_CAPTURE')),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'UNKNOWN')),
  provider_refund_id text unique,
  operation_key text not null unique,
  requested_by uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),
  processed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
comment on column public.refunds.status is 'PROCESSED only with provider evidence. REQUESTED/PROCESSING/UNKNOWN amounts stay reserved.';
create index refunds_status_idx on public.refunds (status, created_at);
create index refunds_booking_idx on public.refunds (booking_id);
create trigger refunds_touch before update on public.refunds for each row execute function app.touch_row();

create or replace function app.guard_refund()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_captured bigint;
  v_reserved bigint;
begin
  if tg_op = 'DELETE' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'refunds'));
  end if;
  if tg_op = 'UPDATE' then
    if (new.payment_attempt_id, new.booking_id, new.amount_paise, new.currency, new.operation_key)
       is distinct from (old.payment_attempt_id, old.booking_id, old.amount_paise, old.currency, old.operation_key) then
      perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'refunds', 'reason', 'identity'));
    end if;
    if old.status in ('PROCESSED', 'FAILED') and new.status <> old.status then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.status = 'PROCESSED' and new.provider_refund_id is null then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'processed_needs_provider_evidence'));
    end if;
  end if;
  -- Serialise on the payment and check the refundable balance (docs/05 refunds).
  select amount_paise into v_captured from public.payment_attempts
   where id = new.payment_attempt_id and state = 'CAPTURED' for update;
  if v_captured is null then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'refund_needs_captured_payment'));
  end if;
  select coalesce(sum(amount_paise), 0) into v_reserved from public.refunds
   where payment_attempt_id = new.payment_attempt_id and status <> 'FAILED' and id <> new.id;
  if new.status <> 'FAILED' and v_reserved + new.amount_paise > v_captured then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'refund_exceeds_captured'));
  end if;
  return new;
end;
$$;
create trigger refunds_guard before insert or update or delete on public.refunds
  for each row execute function app.guard_refund();

-- Ledger: immutable double-entry journals. PROPOSED posting policy pending finance review (decision D04). -------------
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.partners (id),
  code text not null check (code ~ '^[A-Z_]{3,60}$'),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  account_type text not null check (account_type in ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique nulls not distinct (partner_id, code, currency)
);
insert into public.ledger_accounts (code, account_type) values
  ('GATEWAY_CLEARING', 'ASSET'),
  ('CUSTOMER_BOOKING_LIABILITY', 'LIABILITY'),
  ('CUSTOMER_REFUND_LIABILITY', 'LIABILITY'),
  ('UNALLOCATED_SUSPENSE', 'LIABILITY');

create table public.ledger_journals (
  id uuid primary key default gen_random_uuid(),
  business_key text not null unique check (char_length(business_key) between 3 and 200),
  kind text not null check (kind in (
    'CAPTURE_ALLOCATED_BOOKING', 'CAPTURE_REFUND_DUE', 'CAPTURE_QUARANTINED', 'REFUND_PROCESSED'
  )),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  booking_id uuid references public.bookings (id),
  payment_attempt_id uuid references public.payment_attempts (id),
  refund_id uuid references public.refunds (id),
  reverses_journal_id uuid references public.ledger_journals (id),
  evidence_ref text not null check (char_length(evidence_ref) between 3 and 300),
  created_at timestamptz not null default now()
);
create index ledger_journals_booking_idx on public.ledger_journals (booking_id, created_at);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.ledger_journals (id),
  account_id uuid not null references public.ledger_accounts (id),
  side text not null check (side in ('DEBIT', 'CREDIT')),
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now()
);
create index ledger_entries_journal_idx on public.ledger_entries (journal_id);
create index ledger_entries_account_idx on public.ledger_entries (account_id, created_at);

create trigger ledger_journals_append_only before update or delete on public.ledger_journals
  for each row execute function app.forbid_change();
create trigger ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function app.forbid_change();

-- Checked at COMMIT: every journal has at least two entries and debits equal credits. Deferred triggers fire at
-- commit under the caller's role (e.g. simply_worker, which has no table grants), so this one runs as its owner.
create or replace function app.check_journal_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_journal uuid;
  v_count integer;
  v_balance bigint;
begin
  -- Separate branches: a record field that does not exist on this table cannot appear in the expression.
  if tg_table_name = 'ledger_journals' then
    v_journal := new.id;
  else
    v_journal := new.journal_id;
  end if;
  select count(*), coalesce(sum(case when side = 'DEBIT' then amount_paise else -amount_paise end), 0)
    into v_count, v_balance
  from public.ledger_entries where journal_id = v_journal;
  if v_count < 2 or v_balance <> 0 then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD',
      detail = jsonb_build_object('table', 'ledger_entries', 'reason', 'unbalanced_journal')::text;
  end if;
  return null;
end;
$$;
create constraint trigger ledger_journals_balanced after insert on public.ledger_journals
  deferrable initially deferred for each row execute function app.check_journal_balanced();
create constraint trigger ledger_entries_balanced after insert on public.ledger_entries
  deferrable initially deferred for each row execute function app.check_journal_balanced();

-- Posts one journal idempotently by business key. Entries: [{"account": "CODE", "side": "DEBIT", "amount_paise": n}].
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
    select id into v_account from public.ledger_accounts
     where partner_id is null and code = e ->> 'account' and currency = 'INR' and enabled;
    if v_account is null then
      perform app.fail('INTERNAL_ERROR', jsonb_build_object('reason', 'ledger_account_missing', 'account', e ->> 'account'));
    end if;
    insert into public.ledger_entries (journal_id, account_id, side, amount_paise)
    values (v_id, v_account, e ->> 'side', (e ->> 'amount_paise')::bigint);
  end loop;
  return v_id;
end;
$$;

-- Staff arrival verification attempts (rate limit is enforced from this log, so it holds across web instances). ------
create table public.arrival_attempts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  staff_profile_id uuid not null references public.profiles (id),
  method text not null check (method in ('TOKEN', 'PIN')),
  outcome text not null check (outcome in ('SUCCESS', 'FAILED')),
  booking_id uuid references public.bookings (id),
  created_at timestamptz not null default now()
);
create index arrival_attempts_staff_idx on public.arrival_attempts (staff_profile_id, created_at);
create trigger arrival_attempts_append_only before update or delete on public.arrival_attempts
  for each row execute function app.forbid_change();

-- Outbox job kinds for M3 ------------------------------------------------------------------------------------------
alter table public.outbox_jobs drop constraint outbox_jobs_kind_check;
alter table public.outbox_jobs add constraint outbox_jobs_kind_check check (kind in (
  'booking.hold_expired', 'booking.confirmed', 'notification.email', 'privacy.delete_requested', 'diagnostic.sleep',
  'payment.provider_event', 'refund.submit', 'refund.requested'
));

-- Every new table: RLS on and forced; grants come in the M3 RLS migration.
do $$
declare
  t text;
begin
  foreach t in array array['payment_orders', 'payment_attempts', 'payment_attempt_events', 'provider_events', 'refunds',
                           'ledger_accounts', 'ledger_journals', 'ledger_entries', 'arrival_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end
$$;
