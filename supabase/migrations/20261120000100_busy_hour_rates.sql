-- Busy-hour pricing (20 November 2026; docs/concepts/seat-map/PLAN.md phase 5).
--
-- A partner adds rules such as "Fri-Sun 18:00-22:00 +20%" for the whole venue or one seating area. app.price_for
-- applies the rule in force at the booking's start (venue-local weekday and time) to the table's hourly-rate base:
-- an area rule beats a venue-wide rule; among rules at the same level the larger adjustment wins. The quote's price
-- snapshot records the rule (id, label, adjustment) and the base before it, so a booking keeps its price whatever
-- happens to the rule later. Rules are never edited: archive and add a new one. Extensions are priced by
-- app.price_for too, so an extension that starts inside a busy window carries the same adjustment.
--
-- Unchanged: the server alone prices (clients only show the snapshot), the service fee is not adjusted, commission
-- is computed from what was paid (app.booking_earnings), and quotes and bookings already made keep their snapshot.
--
-- Rollback: restore app.price_for and app.partner_seating from 20261026001400 / 20261119000200; drop
-- app.partner_create_rate_rule, app.partner_archive_rate_rule, app.busy_rule_for, app.rate_rule_json,
-- app.guard_rate_rule (and trigger); drop table public.rate_rules. Existing snapshots stay valid (extra fields only).

create table public.rate_rules (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  zone_id uuid,
  label text not null check (char_length(label) between 1 and 40),
  weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  starts_local time not null,
  ends_local time not null,
  adjustment_bps integer not null check (adjustment_bps between -5000 and 10000 and adjustment_bps <> 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (zone_id, venue_id) references public.venue_zones (id, venue_id),
  constraint rate_rules_window check (ends_local > starts_local),
  constraint rate_rules_archived_stamp check ((status = 'ARCHIVED') = (archived_at is not null))
);
create index rate_rules_venue_active on public.rate_rules (venue_id) where status = 'ACTIVE';

-- Only ACTIVE -> ARCHIVED; nothing else changes and nothing is deleted.
create or replace function app.guard_rate_rule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'rate_rules', 'operation', tg_op));
  end if;
  if old.status = 'ACTIVE' and new.status = 'ARCHIVED' and new.archived_at is not null
     and (new.venue_id, new.zone_id, new.label, new.weekdays, new.starts_local, new.ends_local, new.adjustment_bps, new.created_at)
         is not distinct from (old.venue_id, old.zone_id, old.label, old.weekdays, old.starts_local, old.ends_local, old.adjustment_bps, old.created_at) then
    return new;
  end if;
  perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'rate_rules', 'operation', tg_op));
  return null;
end;
$$;
create trigger rate_rules_guard before update or delete on public.rate_rules for each row execute function app.guard_rate_rule();

alter table public.rate_rules enable row level security;
alter table public.rate_rules force row level security;

create or replace function app.rate_rule_json(p_rule public.rate_rules)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', p_rule.id, 'zone_id', p_rule.zone_id, 'label', p_rule.label, 'weekdays', to_jsonb(p_rule.weekdays),
                            'starts_local', to_char(p_rule.starts_local, 'HH24:MI'), 'ends_local', to_char(p_rule.ends_local, 'HH24:MI'),
                            'adjustment_bps', p_rule.adjustment_bps, 'status', p_rule.status, 'created_at', p_rule.created_at);
$$;

-- The rule in force for a table at an instant (venue-local weekday and time), or null.
create or replace function app.busy_rule_for(p_resource_id uuid, p_start timestamptz)
returns public.rate_rules
language sql
stable
set search_path = ''
as $$
  select rr.*
  from public.resources r
  join public.venues v on v.id = r.venue_id
  join public.rate_rules rr on rr.venue_id = r.venue_id and rr.status = 'ACTIVE'
  where r.id = p_resource_id
    and (rr.zone_id is null or rr.zone_id = r.zone_id)
    and extract(dow from (p_start at time zone v.timezone))::smallint = any (rr.weekdays)
    and (p_start at time zone v.timezone)::time >= rr.starts_local
    and (p_start at time zone v.timezone)::time < rr.ends_local
  order by (rr.zone_id is not null) desc, rr.adjustment_bps desc, rr.created_at desc
  limit 1;
$$;

-- Same arithmetic as before, plus the busy-hour adjustment on the table-time base (half-up, integer paise). With no
-- rule in force the result is identical to the previous version (same keys, busy_rule = null).
create or replace function app.price_for(p_resource_id uuid, p_start timestamptz, p_duration_minutes integer)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rate public.resource_rates;
  v_fee public.fee_configurations;
  v_rule public.rate_rules;
  v_plain bigint;
  v_base bigint;
begin
  select r.* into v_rate
  from public.resource_rates r
  where r.resource_id = p_resource_id
    and r.effective_from <= p_start
    and (r.effective_to is null or p_start < r.effective_to);
  if not found then
    return jsonb_build_object('error', 'rate');
  end if;
  select f.* into v_fee
  from public.fee_configurations f
  where f.config_version = v_rate.fee_config_version and f.status = 'APPROVED' and f.effective_from <= p_start;
  if not found then
    return jsonb_build_object('error', 'fee_configuration');
  end if;
  -- No tax rate is approved (decision register D04). Fail closed rather than invent one.
  if jsonb_array_length(v_fee.tax_rules) > 0 then
    return jsonb_build_object('error', 'tax_rules');
  end if;
  v_plain := app.div_half_up(v_rate.hourly_paise * p_duration_minutes, 60);
  v_rule := app.busy_rule_for(p_resource_id, p_start);
  v_base := case when v_rule.id is null then v_plain else app.div_half_up(v_plain * (10000 + v_rule.adjustment_bps), 10000) end;
  return jsonb_build_object(
    'schema', 'price.v1',
    'currency', 'INR',
    'base_paise', v_base,
    'service_fee_paise', v_fee.customer_fee_paise,
    'tax_lines', '[]'::jsonb,
    'discount_paise', 0,
    'total_paise', v_base + v_fee.customer_fee_paise,
    'hourly_paise', v_rate.hourly_paise,
    'duration_minutes', p_duration_minutes,
    'rate_version', v_rate.rate_version,
    'fee_config_version', v_fee.config_version,
    'commission_bps', v_fee.commission_bps,
    'platform_fixed_paise', v_fee.platform_fixed_paise,
    'rounding_rule', v_fee.rounding_rule,
    'synthetic', v_fee.is_synthetic,
    'base_before_busy_paise', v_plain,
    'busy_rule', case when v_rule.id is null then null
                      else jsonb_build_object('id', v_rule.id, 'label', v_rule.label, 'adjustment_bps', v_rule.adjustment_bps) end);
end;
$$;

-- Partner: add a rule (manager/owner with TOTP). p_zone_id null = whole venue.
create or replace function app.partner_create_rate_rule(
  p_venue_id uuid, p_zone_id uuid, p_label text, p_weekdays integer[], p_starts_local text, p_ends_local text,
  p_adjustment_bps integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_starts time;
  v_ends time;
  v_rule public.rate_rules;
begin
  if p_label is null or char_length(trim(p_label)) not between 1 and 40 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'label'));
  end if;
  if p_weekdays is null or cardinality(p_weekdays) not between 1 and 7 or not (p_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'weekdays'));
  end if;
  if p_starts_local !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_ends_local !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'time'));
  end if;
  v_starts := p_starts_local::time;
  v_ends := case when p_ends_local = '24:00' then time '23:59:59.999999' else p_ends_local::time end;
  if v_ends <= v_starts then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'time', 'reason', 'end_before_start'));
  end if;
  if p_adjustment_bps is null or p_adjustment_bps not between -5000 and 10000 or p_adjustment_bps = 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'adjustment_bps'));
  end if;
  if p_zone_id is not null and not exists (select 1 from public.venue_zones where id = p_zone_id and venue_id = p_venue_id and status = 'ACTIVE') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'zone_id'));
  end if;
  perform 1 from public.venues where id = p_venue_id for update;
  if (select count(*) from public.rate_rules where venue_id = p_venue_id and status = 'ACTIVE') >= 20 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'label', 'reason', 'too_many_rules'));
  end if;
  insert into public.rate_rules (venue_id, zone_id, label, weekdays, starts_local, ends_local, adjustment_bps, created_by)
  values (p_venue_id, p_zone_id, trim(p_label), (select array_agg(distinct d order by d)::smallint[] from unnest(p_weekdays) d),
          v_starts, v_ends, p_adjustment_bps, v_actor)
  returning * into v_rule;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'rate_rule.create', 'rate_rule', v_rule.id, p_venue_id, p_request_id, null,
                    jsonb_build_object('adjustment_bps', p_adjustment_bps, 'zone_id', p_zone_id, 'weekdays', to_jsonb(v_rule.weekdays),
                                       'starts_local', p_starts_local, 'ends_local', p_ends_local));
  return app.rate_rule_json(v_rule);
end;
$$;

create or replace function app.partner_archive_rate_rule(p_rule_id uuid, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.rate_rules;
  v_actor uuid;
begin
  select * into v_rule from public.rate_rules where id = p_rule_id;
  v_actor := app.require_venue_manager(v_rule.venue_id);
  select * into v_rule from public.rate_rules where id = p_rule_id for update;
  if v_rule.status <> 'ACTIVE' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_rule.status));
  end if;
  update public.rate_rules set status = 'ARCHIVED', archived_at = now() where id = p_rule_id returning * into v_rule;
  perform app.audit(v_actor, app.manager_role(v_rule.venue_id), 'rate_rule.archive', 'rate_rule', p_rule_id, v_rule.venue_id, p_request_id, null);
  return app.rate_rule_json(v_rule);
end;
$$;

-- Partner seating view now also lists the active busy-hour rules.
create or replace function app.partner_seating(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
begin
  return jsonb_build_object(
    'venue_id', p_venue_id,
    'zones', coalesce((
      select jsonb_agg(app.zone_json(z) || jsonb_build_object(
               'published_layout', (select app.layout_json(l, false) from public.floor_layouts l where l.zone_id = z.id and l.status = 'PUBLISHED'),
               'draft_layout', (select app.layout_json(l, false) from public.floor_layouts l where l.zone_id = z.id and l.status = 'DRAFT'))
             order by z.sort_order, z.name)
      from public.venue_zones z where z.venue_id = p_venue_id and z.status = 'ACTIVE'), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'label', r.label, 'capacity', r.capacity, 'status', r.status, 'zone_id', r.zone_id, 'shape', r.shape,
               'features', to_jsonb(r.features), 'photo_media_id', r.photo_media_id, 'hourly_paise', app.current_hourly_paise(r.id),
               'version', r.version) order by r.label)
      from public.resources r where r.venue_id = p_venue_id and r.status <> 'RETIRED'), '[]'::jsonb),
    'rate_rules', coalesce((
      select jsonb_agg(app.rate_rule_json(rr) order by rr.created_at)
      from public.rate_rules rr where rr.venue_id = p_venue_id and rr.status = 'ACTIVE'), '[]'::jsonb));
end;
$$;

grant execute on function app.partner_create_rate_rule(uuid, uuid, text, integer[], text, text, integer, uuid) to authenticated;
grant execute on function app.partner_archive_rate_rule(uuid, uuid) to authenticated;
-- Internal: busy_rule_for, rate_rule_json, guard_rate_rule (trigger). price_for keeps its earlier (non-granted) status.
revoke execute on all functions in schema app from public;
