-- M2 versioned policies, fee configuration, exclusive resources, rates and opening hours.

create table public.venue_policies (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  policy_version integer not null check (policy_version > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  source_policy_version text not null,
  byo_food text not null check (byo_food in ('ALLOWED', 'RESTRICTED', 'NOT_ALLOWED')),
  byo_details text not null check (char_length(byo_details) between 1 and 1000),
  outside_delivery text not null check (outside_delivery in ('ALLOWED', 'RESTRICTED', 'NOT_ALLOWED')),
  handover_instructions text not null check (char_length(handover_instructions) between 1 and 1000),
  house_rules text not null check (char_length(house_rules) between 1 and 2000),
  cancel_cutoff_minutes integer not null check (cancel_cutoff_minutes >= 0),
  early_refund_bps integer not null check (early_refund_bps between 0 and 10000),
  late_refund_bps integer not null check (late_refund_bps between 0 and 10000),
  no_show_refund_bps integer not null check (no_show_refund_bps between 0 and 10000),
  venue_cancel_refund_bps integer not null default 10000 check (venue_cancel_refund_bps = 10000),
  minimum_minutes integer not null check (minimum_minutes > 0),
  increment_minutes integer not null check (increment_minutes > 0),
  maximum_minutes integer not null,
  buffer_minutes integer not null check (buffer_minutes >= 0),
  grace_minutes integer not null check (grace_minutes >= 0),
  lead_minutes integer not null check (lead_minutes >= 0),
  max_horizon_days integer not null check (max_horizon_days > 0),
  hold_minutes integer not null check (hold_minutes between 1 and 30),
  quote_ttl_minutes integer not null check (quote_ttl_minutes between 1 and 30),
  end_reminder_minutes integer not null check (end_reminder_minutes >= 0),
  effective_from timestamptz not null,
  accepted_terms_version text not null,
  content_hash text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (venue_id, policy_version),
  unique (id, venue_id),
  constraint venue_policies_duration check (
    maximum_minutes >= minimum_minutes
    and minimum_minutes % increment_minutes = 0
    and maximum_minutes % increment_minutes = 0
  ),
  constraint venue_policies_published check (status <> 'PUBLISHED' or (content_hash is not null and published_at is not null))
);
comment on column public.venue_policies.source_policy_version is 'The packages/domain policy version these values came from, e.g. proposed-2026-10-25.';
comment on column public.venue_policies.venue_cancel_refund_bps is 'Partner/service cancellation always refunds in full (docs/05).';
create trigger venue_policies_touch before update on public.venue_policies for each row execute function app.touch_row();

-- The customer-facing snapshot accepted at hold time. jsonb::text is deterministic, so the hash is stable.
create or replace function app.policy_snapshot(p public.venue_policies)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'schema', 'policy.v1',
    'policy_id', p.id,
    'venue_id', p.venue_id,
    'policy_version', p.policy_version,
    'source_policy_version', p.source_policy_version,
    'byo_food', p.byo_food,
    'byo_details', p.byo_details,
    'outside_delivery', p.outside_delivery,
    'handover_instructions', p.handover_instructions,
    'house_rules', p.house_rules,
    'cancel_cutoff_minutes', p.cancel_cutoff_minutes,
    'early_refund_bps', p.early_refund_bps,
    'late_refund_bps', p.late_refund_bps,
    'no_show_refund_bps', p.no_show_refund_bps,
    'venue_cancel_refund_bps', p.venue_cancel_refund_bps,
    'minimum_minutes', p.minimum_minutes,
    'increment_minutes', p.increment_minutes,
    'maximum_minutes', p.maximum_minutes,
    'buffer_minutes', p.buffer_minutes,
    'grace_minutes', p.grace_minutes,
    'lead_minutes', p.lead_minutes,
    'max_horizon_days', p.max_horizon_days,
    'hold_minutes', p.hold_minutes,
    'end_reminder_minutes', p.end_reminder_minutes,
    'accepted_terms_version', p.accepted_terms_version
  );
$$;

create or replace function app.policy_hash(p_snapshot jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'sha256:' || encode(extensions.digest(convert_to(p_snapshot::text, 'UTF8'), 'sha256'), 'hex');
$$;

-- Published policies are immutable; the hash is always computed here, never supplied by a caller.
create or replace function app.guard_venue_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'PUBLISHED' then
      perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'venue_policies'));
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'PUBLISHED' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'venue_policies'));
  end if;
  if new.status = 'PUBLISHED' then
    new.content_hash := app.policy_hash(app.policy_snapshot(new));
    new.published_at := coalesce(new.published_at, now());
  else
    new.content_hash := null;
    new.published_at := null;
  end if;
  return new;
end;
$$;
create trigger venue_policies_guard before insert or update or delete on public.venue_policies
  for each row execute function app.guard_venue_policy();

alter table public.venues
  add constraint venues_active_policy_fk foreign key (active_policy_id, id) references public.venue_policies (id, venue_id);

create or replace function app.validate_active_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active_policy_id is not null and not exists (
    select 1 from public.venue_policies p where p.id = new.active_policy_id and p.status = 'PUBLISHED'
  ) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'active_policy_id', 'reason', 'not_published'));
  end if;
  if new.status = 'PUBLISHED' and new.active_policy_id is null then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'active_policy_id'));
  end if;
  return new;
end;
$$;
create trigger venues_active_policy before insert or update on public.venues
  for each row execute function app.validate_active_policy();

create table public.fee_configurations (
  id uuid primary key default gen_random_uuid(),
  config_version text not null unique check (char_length(config_version) between 1 and 60),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'RETIRED')),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  commission_bps integer not null check (commission_bps between 0 and 10000),
  platform_fixed_paise bigint not null default 0 check (platform_fixed_paise >= 0),
  customer_fee_paise bigint not null default 0 check (customer_fee_paise >= 0),
  tax_rules jsonb not null default '[]'::jsonb check (jsonb_typeof(tax_rules) = 'array' and pg_column_size(tax_rules) < 8192),
  rounding_rule text not null default 'HALF_UP_PAISE' check (rounding_rule = 'HALF_UP_PAISE'),
  effective_from timestamptz not null,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint fee_configurations_approval check (
    status = 'DRAFT' or (approved_at is not null and (approved_by is not null or is_synthetic))
  )
);
comment on column public.fee_configurations.is_synthetic is 'Sandbox-only configuration. Approval without an approver is allowed only for synthetic configs.';
create trigger fee_configurations_touch before update on public.fee_configurations for each row execute function app.touch_row();

create or replace function app.guard_fee_configuration()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'fee_configurations'));
    end if;
    return old;
  end if;
  -- An approved configuration may only be retired; no retroactive financial edits.
  if old.status = 'APPROVED' and (
    new.status not in ('APPROVED', 'RETIRED')
    or (new.commission_bps, new.platform_fixed_paise, new.customer_fee_paise, new.tax_rules, new.rounding_rule,
        new.effective_from, new.currency, new.config_version)
       is distinct from
       (old.commission_bps, old.platform_fixed_paise, old.customer_fee_paise, old.tax_rules, old.rounding_rule,
        old.effective_from, old.currency, old.config_version)
  ) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'fee_configurations'));
  end if;
  if old.status = 'RETIRED' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'fee_configurations'));
  end if;
  return new;
end;
$$;
create trigger fee_configurations_guard before update or delete on public.fee_configurations
  for each row execute function app.guard_fee_configuration();

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  label text not null check (char_length(label) between 1 and 80),
  kind text not null default 'TABLE' check (kind = 'TABLE'),
  capacity smallint not null check (capacity between 1 and 50),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'RETIRED')),
  operational_state text not null default 'READY' check (operational_state in ('READY', 'OCCUPIED', 'CLEANING', 'OUT_OF_SERVICE')),
  operational_since timestamptz not null default now(),
  staff_note text check (staff_note is null or char_length(staff_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (venue_id, label),
  unique (id, venue_id)
);
create index resources_venue_status_idx on public.resources (venue_id, status);
create trigger resources_touch before update on public.resources for each row execute function app.touch_row();
-- Historical inventory stays referentially intact: no deletes, retire instead.
create trigger resources_no_delete before delete on public.resources for each row execute function app.forbid_change();

create table public.resource_rates (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id),
  rate_version integer not null check (rate_version > 0),
  hourly_paise bigint not null check (hourly_paise > 0),
  currency char(3) not null default 'INR' check (currency = 'INR'),
  effective_from timestamptz not null,
  effective_to timestamptz,
  fee_config_version text not null references public.fee_configurations (config_version),
  created_at timestamptz not null default now(),
  unique (resource_id, rate_version),
  constraint resource_rates_period check (effective_to is null or effective_to > effective_from),
  constraint resource_rates_no_overlap exclude using gist (
    resource_id with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  )
);
create index resource_rates_resource_idx on public.resource_rates (resource_id, effective_from);

-- Old rates are immutable. The only permitted change is closing an open-ended rate (effective_to NULL -> value).
create or replace function app.guard_resource_rate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'resource_rates'));
  end if;
  if old.effective_to is not null
     or (new.resource_id, new.rate_version, new.hourly_paise, new.currency, new.effective_from, new.fee_config_version)
        is distinct from
        (old.resource_id, old.rate_version, old.hourly_paise, old.currency, old.effective_from, old.fee_config_version) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'resource_rates'));
  end if;
  return new;
end;
$$;
create trigger resource_rates_guard before update or delete on public.resource_rates
  for each row execute function app.guard_resource_rate();

create table public.opening_periods (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  weekday smallint not null check (weekday between 0 and 6),
  opens_local time not null,
  closes_local time not null,
  closes_next_day boolean not null default false,
  schedule_version integer not null check (schedule_version > 0),
  created_at timestamptz not null default now(),
  -- weekday follows PostgreSQL extract(dow): 0 = Sunday. An overnight period closes at or before it opens.
  constraint opening_periods_shape check (closes_next_day = (closes_local <= opens_local))
);
comment on table public.opening_periods is 'Venue-local weekly hours per schedule version. Booking ranges plus cleaning buffer must fit inside one period.';
create index opening_periods_lookup_idx on public.opening_periods (venue_id, schedule_version, weekday);

-- Rejects overlapping periods within a schedule version, including overnight periods that wrap past Saturday.
create or replace function app.guard_opening_period()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_start integer := new.weekday * 1440 + extract(epoch from new.opens_local)::integer / 60;
  v_end integer := new.weekday * 1440 + extract(epoch from new.closes_local)::integer / 60
                   + case when new.closes_next_day then 1440 else 0 end;
begin
  if exists (
    select 1
    from public.opening_periods o
    cross join (values (-10080), (0), (10080)) as shift (minutes)
    where o.venue_id = new.venue_id
      and o.schedule_version = new.schedule_version
      and o.id is distinct from new.id
      and int4range(v_start, v_end, '[)') && int4range(
        o.weekday * 1440 + extract(epoch from o.opens_local)::integer / 60 + shift.minutes,
        o.weekday * 1440 + extract(epoch from o.closes_local)::integer / 60
          + case when o.closes_next_day then 1440 else 0 end + shift.minutes,
        '[)')
  ) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'opening_periods', 'reason', 'overlap'));
  end if;
  return new;
end;
$$;
create trigger opening_periods_guard before insert or update on public.opening_periods
  for each row execute function app.guard_opening_period();
