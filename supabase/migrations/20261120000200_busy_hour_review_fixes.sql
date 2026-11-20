-- Busy-hour pricing: fixes from the independent review of 20261120000100 (20 November 2026).
--
-- 1. Every minute of a booking is priced by the rule covering that minute (not just the start minute), so a booking
--    that starts just before a window pays the adjustment for the part inside it. With no rule in force the
--    arithmetic is identical to before: div_half_up(hourly * sum(10000 + bps per minute), 60 * 10000).
-- 2. Windows may cross midnight (ends_local <= starts_local); the weekday is the day the window starts. "Until 24:00"
--    is stored as 00:00 and returned as "24:00", so it is no longer confused with a real 23:59.
-- 3. The per-table price in app.venue_day_availability (one price for the whole day) is the plain table price;
--    the response says when the venue has busy-hour prices. The quote always carries the real price.
-- 4. Archiving an area archives its busy-hour rules.
-- 5. Snapshots no longer carry the partner-written rule label: `busy_rules` = [{id, adjustment_bps, minutes}].
--    Snapshots written by 20261120000100 (`busy_rule`) stay valid.
-- 6. The editor state (areas, tables) has one definition, app.seating_editor_state; partner_seating composes it.
-- 7. When a venue has no active rule, app.price_for skips the per-minute work.
--
-- Rollback: re-run the function definitions from 20261120000100 (price_for, partner_create_rate_rule, rate_rule_json,
-- partner_seating, busy_rule_for), venue_day_availability from 20261026001400 and partner_archive_zone from
-- 20261119000200; re-add rate_rules_window as NOT VALID; drop app.rule_covers, app.plain_price_for,
-- app.seating_editor_state.

alter table public.rate_rules drop constraint rate_rules_window;

-- Does the rule cover this venue-local instant? An overnight window (end <= start) continues into the next day.
create or replace function app.rule_covers(p_rule public.rate_rules, p_local timestamp)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (extract(dow from p_local)::smallint = any (p_rule.weekdays)
          and p_local::time >= p_rule.starts_local
          and (p_rule.ends_local <= p_rule.starts_local or p_local::time < p_rule.ends_local))
      or (p_rule.ends_local <= p_rule.starts_local
          and ((extract(dow from p_local)::int + 6) % 7)::smallint = any (p_rule.weekdays)
          and p_local::time < p_rule.ends_local);
$$;

drop function app.busy_rule_for(uuid, timestamptz);

create or replace function app.rate_rule_json(p_rule public.rate_rules)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', p_rule.id, 'zone_id', p_rule.zone_id, 'label', p_rule.label, 'weekdays', to_jsonb(p_rule.weekdays),
                            'starts_local', to_char(p_rule.starts_local, 'HH24:MI'),
                            -- 00:00 (and the earlier 23:59:59.999999 sentinel) mean "until midnight".
                            'ends_local', case when p_rule.ends_local in (time '00:00', time '23:59:59.999999') then '24:00'
                                               else to_char(p_rule.ends_local, 'HH24:MI') end,
                            'overnight', p_rule.ends_local < p_rule.starts_local and p_rule.ends_local <> time '00:00',
                            'adjustment_bps', p_rule.adjustment_bps, 'status', p_rule.status, 'created_at', p_rule.created_at);
$$;

create or replace function app.price_for(p_resource_id uuid, p_start timestamptz, p_duration_minutes integer)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rate public.resource_rates;
  v_fee public.fee_configurations;
  v_venue uuid;
  v_zone uuid;
  v_tz text;
  v_weight bigint;
  v_rules jsonb := '[]'::jsonb;
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
  v_base := v_plain;
  select r.venue_id, r.zone_id, v.timezone into v_venue, v_zone, v_tz
  from public.resources r join public.venues v on v.id = r.venue_id where r.id = p_resource_id;
  if p_duration_minutes > 0 and exists (select 1 from public.rate_rules where venue_id = v_venue and status = 'ACTIVE') then
    -- One row per booked minute with the winning rule (area beats venue, then the larger change).
    with minutes as (
      select g, w.id, w.adjustment_bps
      from generate_series(0, p_duration_minutes - 1) g
      left join lateral (
        select rr.id, rr.adjustment_bps
        from public.rate_rules rr
        where rr.venue_id = v_venue and rr.status = 'ACTIVE' and (rr.zone_id is null or rr.zone_id = v_zone)
          and app.rule_covers(rr, (p_start + make_interval(mins => g)) at time zone v_tz)
        order by (rr.zone_id is not null) desc, rr.adjustment_bps desc, rr.created_at desc
        limit 1
      ) w on true
    )
    select sum(10000 + coalesce(m.adjustment_bps, 0)),
           coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'adjustment_bps', x.adjustment_bps, 'minutes', x.n) order by x.first_minute)
                     from (select id, adjustment_bps, count(*) as n, min(g) as first_minute from minutes where id is not null
                           group by id, adjustment_bps) x), '[]'::jsonb)
    into v_weight, v_rules
    from minutes m;
    v_base := app.div_half_up(v_rate.hourly_paise * v_weight, 600000);
  end if;
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
    'busy_rules', v_rules);
end;
$$;

-- The table's plain price (no busy-hour adjustment), for places that show one price for a whole day.
create or replace function app.plain_price_for(p_resource_id uuid, p_start timestamptz, p_duration_minutes integer)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_price jsonb := app.price_for(p_resource_id, p_start, p_duration_minutes);
  v_plain bigint;
begin
  if v_price ? 'error' then
    return v_price;
  end if;
  v_plain := (v_price ->> 'base_before_busy_paise')::bigint;
  return v_price || jsonb_build_object('base_paise', v_plain, 'total_paise', v_plain + (v_price ->> 'service_fee_paise')::bigint,
                                       'busy_rules', '[]'::jsonb);
end;
$$;

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
  -- 24:00 = midnight = 00:00 of the next day. An end at or before the start crosses midnight; an empty window
  -- (same start and end, other than 00:00-24:00 for a whole day) is refused.
  v_ends := case when p_ends_local = '24:00' then time '00:00' else p_ends_local::time end;
  if p_ends_local <> '24:00' and v_ends = v_starts then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'time', 'reason', 'empty_window'));
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

-- Archiving an area also archives its busy-hour rules (otherwise they would stay active against nothing).
create or replace function app.partner_archive_zone(p_zone_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone public.venue_zones;
  v_actor uuid;
begin
  select * into v_zone from public.venue_zones where id = p_zone_id;
  v_actor := app.require_venue_manager(v_zone.venue_id);
  select * into v_zone from public.venue_zones where id = p_zone_id for update;
  if v_zone.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_zone.version));
  end if;
  if v_zone.status <> 'ACTIVE' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_zone.status));
  end if;
  if exists (select 1 from public.resources where zone_id = p_zone_id and status <> 'RETIRED') then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'area_has_tables'));
  end if;
  delete from public.floor_layouts where zone_id = p_zone_id and status = 'DRAFT';
  update public.floor_layouts set status = 'ARCHIVED' where zone_id = p_zone_id and status = 'PUBLISHED';
  update public.rate_rules set status = 'ARCHIVED', archived_at = now() where zone_id = p_zone_id and status = 'ACTIVE';
  update public.venue_zones set status = 'ARCHIVED' where id = p_zone_id returning * into v_zone;
  perform app.audit(v_actor, app.manager_role(v_zone.venue_id), 'zone.archive', 'venue_zone', p_zone_id, v_zone.venue_id, p_request_id, null);
  return app.zone_json(v_zone);
end;
$$;

-- Editor state in one place; app.partner_seating adds the caller check and the busy-hour rules.
create or replace function app.seating_editor_state(p_venue_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
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
      from public.resources r where r.venue_id = p_venue_id and r.status <> 'RETIRED'), '[]'::jsonb));
$$;

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
  return app.seating_editor_state(p_venue_id) || jsonb_build_object(
    'rate_rules', coalesce((
      select jsonb_agg(app.rate_rule_json(rr) order by rr.created_at)
      from public.rate_rules rr where rr.venue_id = p_venue_id and rr.status = 'ACTIVE'), '[]'::jsonb));
end;
$$;

-- One price per table for the whole day: the plain table price (busy-hour adjustments depend on the start time and
-- are in the quote). Copied from 20261026001400; changes: plain_price_for, and has_busy_pricing in the result.
create or replace function app.venue_day_availability(p_venue_id uuid, p_date date, p_duration_minutes integer, p_party_size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_venue public.venues;
  v_policy public.venue_policies;
  v_tables jsonb;
  v_party integer := greatest(1, coalesce(p_party_size, 1));
begin
  select * into v_venue from public.venues where id = p_venue_id and status = 'PUBLISHED';
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  select * into v_policy from public.venue_policies where id = v_venue.active_policy_id and status = 'PUBLISHED';
  if not found then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'policy'));
  end if;
  if p_date is null or p_duration_minutes is null then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'date'));
  end if;
  if p_duration_minutes < v_policy.minimum_minutes or p_duration_minutes > v_policy.maximum_minutes
     or p_duration_minutes % v_policy.increment_minutes <> 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object(
      'field', 'duration_minutes', 'minimum_minutes', v_policy.minimum_minutes,
      'maximum_minutes', v_policy.maximum_minutes, 'increment_minutes', v_policy.increment_minutes));
  end if;

  select coalesce(jsonb_agg(t.item order by t.label), '[]'::jsonb) into v_tables
  from (
    select r.label, jsonb_build_object(
      'resource_id', r.id,
      'label', r.label,
      'capacity', r.capacity,
      'price', app.plain_price_for(r.id, (p_date + time '12:00') at time zone v_venue.timezone, p_duration_minutes),
      'starts', coalesce((
        select jsonb_agg(s.start_at order by s.start_at)
        from (
          select (p_date + make_interval(mins => g * v_policy.increment_minutes)) at time zone v_venue.timezone as start_at
          from generate_series(0, (1440 / v_policy.increment_minutes) - 1) g
        ) s
        where app.slot_problem(v_venue, r, v_policy, s.start_at, s.start_at + make_interval(mins => p_duration_minutes),
                               v_party, v_now) is null
          and not app.is_blocked(r.id, s.start_at,
                                 s.start_at + make_interval(mins => p_duration_minutes + v_policy.buffer_minutes), v_now)
      ), '[]'::jsonb)) as item
    from public.resources r
    where r.venue_id = v_venue.id and r.status = 'ACTIVE' and r.capacity >= v_party
  ) t;

  return jsonb_build_object(
    'venue_id', v_venue.id,
    'date', p_date,
    'timezone', v_venue.timezone,
    'duration_minutes', p_duration_minutes,
    'party_size', v_party,
    'increment_minutes', v_policy.increment_minutes,
    'tables', v_tables,
    'reason', case when jsonb_array_length(v_tables) = 0 then 'PARTY_TOO_LARGE' end,
    'has_busy_pricing', exists (select 1 from public.rate_rules where venue_id = v_venue.id and status = 'ACTIVE'),
    'checked_at', v_now);
end;
$$;

-- Internal: rule_covers, plain_price_for, seating_editor_state. Grants on the partner/public functions are unchanged.
revoke execute on all functions in schema app from public;
