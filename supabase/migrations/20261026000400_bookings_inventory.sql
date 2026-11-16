-- M2 bookings and exclusive inventory (docs/05 "Booking and inventory records", docs/07 s.5).

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id),
  venue_id uuid not null references public.venues (id),
  resource_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  party_size smallint not null check (party_size between 1 and 50),
  price_snapshot jsonb not null check (jsonb_typeof(price_snapshot) = 'object' and pg_column_size(price_snapshot) < 4096),
  policy_snapshot jsonb not null check (jsonb_typeof(policy_snapshot) = 'object' and pg_column_size(policy_snapshot) < 8192),
  policy_id uuid not null,
  policy_hash text not null,
  rate_version integer not null,
  total_paise bigint not null check (total_paise >= 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  expires_at timestamptz not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'USED', 'EXPIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint quotes_range check (start_at < end_at),
  constraint quotes_resource_fk foreign key (resource_id, venue_id) references public.resources (id, venue_id),
  constraint quotes_policy_fk foreign key (policy_id, venue_id) references public.venue_policies (id, venue_id)
);
comment on table public.quotes is 'Advisory server-priced quote. Creates no inventory commitment.';
create index quotes_customer_created_idx on public.quotes (customer_id, created_at);
create index quotes_expires_idx on public.quotes (expires_at);
create trigger quotes_touch before update on public.quotes for each row execute function app.touch_row();

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique default app.new_public_ref(),
  customer_id uuid not null references public.profiles (id),
  venue_id uuid not null references public.venues (id),
  resource_id uuid not null,
  quote_id uuid not null unique references public.quotes (id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  party_size smallint not null check (party_size between 1 and 50),
  status text not null default 'HOLD' check (status in (
    'HOLD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW'
  )),
  hold_expires_at timestamptz,
  price_snapshot jsonb not null,
  policy_snapshot jsonb not null,
  accepted_policy_hash text not null,
  accepted_at timestamptz not null,
  total_paise bigint not null check (total_paise >= 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 200),
  cancelled_at timestamptz,
  expired_at timestamptz,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  checkin_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (id, venue_id),
  constraint bookings_range check (start_at < end_at),
  constraint bookings_resource_fk foreign key (resource_id, venue_id) references public.resources (id, venue_id),
  constraint bookings_hold_deadline check (status not in ('HOLD', 'PENDING_PAYMENT') or hold_expires_at is not null),
  constraint bookings_token_only_when_confirmed check (checkin_token_hash is null or status in ('CONFIRMED', 'CHECKED_IN'))
);
comment on column public.bookings.checkin_token_hash is 'Hash of the opaque arrival token (M3). Never granted to clients.';
create index bookings_customer_start_idx on public.bookings (customer_id, start_at desc);
create index bookings_venue_start_status_idx on public.bookings (venue_id, start_at, status);
create index bookings_status_hold_idx on public.bookings (status, hold_expires_at);
create index bookings_resource_status_idx on public.bookings (resource_id, status);
create trigger bookings_touch before update on public.bookings for each row execute function app.touch_row();

-- Accepted price/policy snapshots and identity fields never change; status follows docs/07 s.5 only.
create or replace function app.guard_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if tg_op = 'DELETE' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'bookings'));
  end if;
  if (new.public_ref, new.customer_id, new.venue_id, new.resource_id, new.quote_id, new.start_at, new.end_at,
      new.party_size, new.price_snapshot, new.policy_snapshot, new.accepted_policy_hash, new.accepted_at,
      new.total_paise, new.currency)
     is distinct from
     (old.public_ref, old.customer_id, old.venue_id, old.resource_id, old.quote_id, old.start_at, old.end_at,
      old.party_size, old.price_snapshot, old.policy_snapshot, old.accepted_policy_hash, old.accepted_at,
      old.total_paise, old.currency) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'bookings', 'reason', 'snapshot_or_identity'));
  end if;
  if new.status is distinct from old.status then
    v_allowed := (old.status, new.status) in (
      ('HOLD', 'PENDING_PAYMENT'), ('HOLD', 'CONFIRMED'), ('HOLD', 'EXPIRED'), ('HOLD', 'CANCELLED'),
      ('PENDING_PAYMENT', 'CONFIRMED'), ('PENDING_PAYMENT', 'EXPIRED'), ('PENDING_PAYMENT', 'CANCELLED'),
      ('CONFIRMED', 'CHECKED_IN'), ('CONFIRMED', 'NO_SHOW'), ('CONFIRMED', 'CANCELLED'),
      ('CHECKED_IN', 'COMPLETED')
    );
    if not v_allowed then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  return new;
end;
$$;
create trigger bookings_guard before update or delete on public.bookings for each row execute function app.guard_booking();

create table public.inventory_claims (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  resource_id uuid not null,
  booking_id uuid,
  kind text not null check (kind in ('BOOKING', 'CLOSURE')),
  blocked_range tstzrange not null,
  active boolean not null default true,
  expires_at timestamptz,
  reason text check (reason is null or char_length(reason) between 3 and 500),
  released_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint inventory_claims_resource_fk foreign key (resource_id, venue_id) references public.resources (id, venue_id),
  constraint inventory_claims_booking_fk foreign key (booking_id, venue_id) references public.bookings (id, venue_id),
  constraint inventory_claims_range check (
    not isempty(blocked_range)
    and not lower_inf(blocked_range) and not upper_inf(blocked_range)
    and lower_inc(blocked_range) and not upper_inc(blocked_range)
  ),
  constraint inventory_claims_kind check (
    (kind = 'BOOKING' and booking_id is not null)
    or (kind = 'CLOSURE' and booking_id is null and reason is not null)
  ),
  constraint inventory_claims_release check (active or released_at is not null),
  -- Last line of defence for exclusive inventory: no two active claims may overlap on one table.
  constraint no_active_overlap exclude using gist (resource_id with =, blocked_range with &&) where (active)
);
comment on table public.inventory_claims is 'Held, confirmed and closure claims. Expiry is an explicit update to active=false, never a view filter.';
create unique index inventory_claims_one_per_booking on public.inventory_claims (booking_id) where kind = 'BOOKING';
create index inventory_claims_active_expiry_idx on public.inventory_claims (active, expires_at);
create index inventory_claims_venue_idx on public.inventory_claims (venue_id);
create trigger inventory_claims_touch before update on public.inventory_claims for each row execute function app.touch_row();
create trigger inventory_claims_no_delete before delete on public.inventory_claims for each row execute function app.forbid_change();

create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id),
  actor_id uuid references public.profiles (id),
  event_type text not null check (char_length(event_type) between 1 and 60),
  from_status text,
  to_status text,
  reason_code text,
  request_id uuid,
  business_key text unique,
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata) = 'object' and pg_column_size(safe_metadata) < 4096),
  created_at timestamptz not null default now()
);
create index booking_events_booking_idx on public.booking_events (booking_id, created_at);
create trigger booking_events_append_only before update or delete on public.booking_events
  for each row execute function app.forbid_change();
