-- Seating areas, floor layouts and area prices (19 November 2026; docs/concepts/seat-map/PLAN.md phase 1).
--
-- * public.venue_zones: a venue's seating areas (ground floor indoor, terrace, 1st floor ...), each with an optional
--   default hourly price that the partner can apply to all of its tables.
-- * public.resources gains zone_id, shape, features and an optional photo (an APPROVED venue photo).
-- * public.floor_layouts / public.layout_elements: a versioned top-down drawing per area. A layout is edited as a DRAFT
--   and then PUBLISHED; a published layout (and its elements) never changes - the next publish archives it.
--
-- Unchanged guarantees: the drawing is presentation only. Inventory stays exclusive per table (inventory_claims
-- exclusion constraint), quotes keep reading public.resource_rates, publishing a layout never moves or cancels a
-- booking, and every write goes through a SECURITY DEFINER function that re-checks the manager's membership and TOTP
-- and writes an audit event. Customers read only published layouts of published venues.
--
-- Rollback: drop the functions below; drop table public.layout_elements, public.floor_layouts; alter table
-- public.resources drop column zone_id, shape, features, photo_media_id; drop table public.venue_zones. Rate versions
-- written by app.partner_set_zone_price are ordinary resource_rates rows and stay valid.

-- Areas --------------------------------------------------------------------------------------------------------------
create table public.venue_zones (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'INDOOR' check (kind in ('INDOOR', 'OUTDOOR', 'ROOFTOP', 'PRIVATE_ROOM')),
  floor_level smallint not null default 0 check (floor_level between -2 and 20),
  features text[] not null default '{}'
    check (features <@ array['AIR_CONDITIONED', 'COVERED', 'QUIET', 'SMOKING_ALLOWED', 'PET_FRIENDLY', 'STEP_FREE']::text[]),
  default_hourly_paise bigint check (default_hourly_paise is null or default_hourly_paise between 100 and 10000000),
  sort_order smallint not null default 0 check (sort_order between 0 and 99),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (id, venue_id)
);
create unique index venue_zones_active_name on public.venue_zones (venue_id, lower(name)) where status = 'ACTIVE';
create index venue_zones_venue_idx on public.venue_zones (venue_id, sort_order);
create trigger venue_zones_touch before update on public.venue_zones for each row execute function app.touch_row();
create trigger venue_zones_no_delete before delete on public.venue_zones for each row execute function app.forbid_change();

-- Tables: area, shape, features, photo ---------------------------------------------------------------------------------
alter table public.resources
  add column zone_id uuid,
  add column shape text not null default 'SQUARE' check (shape in ('ROUND', 'SQUARE', 'RECTANGLE', 'BAR_STOOL', 'SOFA')),
  add column features text[] not null default '{}'
    check (features <@ array['WINDOW', 'POWER_SOCKET', 'AIR_CONDITIONED', 'SOFA_SEATING', 'STEP_FREE', 'QUIET', 'VIEW']::text[]),
  add column photo_media_id uuid references public.venue_media (id),
  add constraint resources_zone_same_venue foreign key (zone_id, venue_id) references public.venue_zones (id, venue_id);
create index resources_zone_idx on public.resources (zone_id) where zone_id is not null;

-- Layouts ----------------------------------------------------------------------------------------------------------------
create table public.floor_layouts (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null,
  venue_id uuid not null,
  layout_version integer not null check (layout_version > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  width integer not null check (width between 200 and 4000),
  height integer not null check (height between 200 and 4000),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  foreign key (zone_id, venue_id) references public.venue_zones (id, venue_id),
  unique (zone_id, layout_version),
  constraint floor_layouts_published_stamp check ((status = 'DRAFT') = (published_at is null))
);
create unique index floor_layouts_one_published on public.floor_layouts (zone_id) where status = 'PUBLISHED';
create unique index floor_layouts_one_draft on public.floor_layouts (zone_id) where status = 'DRAFT';
create trigger floor_layouts_touch before update on public.floor_layouts for each row execute function app.touch_row();

create table public.layout_elements (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.floor_layouts (id) on delete cascade,
  element_type text not null
    check (element_type in ('TABLE', 'WALL', 'DOOR', 'WINDOW', 'COUNTER', 'STAIRS', 'PILLAR', 'PLANT', 'LABEL')),
  resource_id uuid references public.resources (id),
  label text check (label is null or char_length(label) between 1 and 40),
  x integer not null check (x between 0 and 4000),
  y integer not null check (y between 0 and 4000),
  width integer not null check (width between 4 and 4000),
  height integer not null check (height between 4 and 4000),
  rotation smallint not null default 0 check (rotation in (0, 90, 180, 270)),
  sort_order smallint not null default 0,
  constraint layout_elements_table_ref check ((element_type = 'TABLE') = (resource_id is not null)),
  unique (layout_id, resource_id)
);
create index layout_elements_layout_idx on public.layout_elements (layout_id, sort_order);

-- A published or archived layout is frozen: only DRAFT -> PUBLISHED -> ARCHIVED, and only drafts may be deleted.
create or replace function app.guard_floor_layout()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'floor_layouts', 'status', old.status));
    end if;
    return old;
  end if;
  if old.status = 'DRAFT' then
    if new.status not in ('DRAFT', 'PUBLISHED') then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    return new;
  end if;
  if old.status = 'PUBLISHED' and new.status = 'ARCHIVED' and new.width = old.width and new.height = old.height
     and new.layout_version = old.layout_version and new.zone_id = old.zone_id then
    return new;
  end if;
  perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'floor_layouts', 'status', old.status));
  return null;
end;
$$;
create trigger floor_layouts_guard before update or delete on public.floor_layouts for each row execute function app.guard_floor_layout();

create or replace function app.guard_layout_element()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.floor_layouts where id = coalesce(new.layout_id, old.layout_id);
  -- The cascade from deleting a draft layout finds no parent row any more.
  if v_status is not null and v_status <> 'DRAFT' then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'layout_elements', 'layout_status', v_status));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger layout_elements_guard before insert or update or delete on public.layout_elements
  for each row execute function app.guard_layout_element();

-- RLS: no direct client access; reads and writes go through the functions below.
alter table public.venue_zones enable row level security;
alter table public.venue_zones force row level security;
alter table public.floor_layouts enable row level security;
alter table public.floor_layouts force row level security;
alter table public.layout_elements enable row level security;
alter table public.layout_elements force row level security;

-- Helpers ----------------------------------------------------------------------------------------------------------------
create or replace function app.zone_json(p_zone public.venue_zones)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', p_zone.id, 'name', p_zone.name, 'kind', p_zone.kind, 'floor_level', p_zone.floor_level,
                            'features', to_jsonb(p_zone.features), 'default_hourly_paise', p_zone.default_hourly_paise,
                            'sort_order', p_zone.sort_order, 'status', p_zone.status, 'version', p_zone.version);
$$;

-- The current (open, already effective) hourly rate of a table, or null.
create or replace function app.current_hourly_paise(p_resource_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select rr.hourly_paise from public.resource_rates rr
  where rr.resource_id = p_resource_id and rr.effective_from <= now() and (rr.effective_to is null or rr.effective_to > now());
$$;

-- Problems with a set of layout elements for one area ([] when valid). Elements are
-- {type, resource_id?, label?, x, y, width, height, rotation?}. Tables must belong to the area, be active or paused,
-- appear once, fit the canvas and not overlap other tables (rotation 90/270 swaps width and height).
create or replace function app.layout_problems(p_zone public.venue_zones, p_width integer, p_height integer, p_elements jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problems jsonb := '[]'::jsonb;
  v_el jsonb;
  v_i integer := 0;
  v_type text;
  v_resource public.resources;
  v_seen uuid[] := '{}';
  v_boxes jsonb := '[]'::jsonb;
  v_w integer;
  v_h integer;
  v_x integer;
  v_y integer;
  v_rot integer;
  v_box jsonb;
begin
  if p_width is null or p_width not between 200 and 4000 or p_height is null or p_height not between 200 and 4000 then
    return jsonb_build_array(jsonb_build_object('field', 'canvas', 'code', 'size'));
  end if;
  if p_elements is null or jsonb_typeof(p_elements) <> 'array' then
    return jsonb_build_array(jsonb_build_object('field', 'elements', 'code', 'not_an_array'));
  end if;
  if jsonb_array_length(p_elements) > 300 then
    return jsonb_build_array(jsonb_build_object('field', 'elements', 'code', 'too_many'));
  end if;
  for v_el in select value from jsonb_array_elements(p_elements) loop
    v_type := v_el ->> 'type';
    begin
      v_x := (v_el ->> 'x')::integer; v_y := (v_el ->> 'y')::integer;
      v_w := (v_el ->> 'width')::integer; v_h := (v_el ->> 'height')::integer;
      v_rot := coalesce((v_el ->> 'rotation')::integer, 0);
    exception when others then
      v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'bad_number');
      v_i := v_i + 1;
      continue;
    end;
    if v_type is null or v_type not in ('TABLE', 'WALL', 'DOOR', 'WINDOW', 'COUNTER', 'STAIRS', 'PILLAR', 'PLANT', 'LABEL') then
      v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'type');
    elsif v_x is null or v_y is null or v_w is null or v_h is null or v_x < 0 or v_y < 0 or v_w not between 4 and 4000
          or v_h not between 4 and 4000 or v_rot not in (0, 90, 180, 270) then
      v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'geometry');
    else
      if v_rot in (90, 270) then
        v_box := jsonb_build_object('x', v_x, 'y', v_y, 'w', v_h, 'h', v_w);
      else
        v_box := jsonb_build_object('x', v_x, 'y', v_y, 'w', v_w, 'h', v_h);
      end if;
      if v_x + (v_box ->> 'w')::integer > p_width or v_y + (v_box ->> 'h')::integer > p_height then
        v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'outside_canvas');
      end if;
      if v_el ? 'label' and v_el ->> 'label' is not null and char_length(v_el ->> 'label') not between 1 and 40 then
        v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'label');
      end if;
      if v_type = 'TABLE' then
        select * into v_resource from public.resources
        where id = case when (v_el ->> 'resource_id') ~ '^[0-9a-fA-F-]{36}$' then (v_el ->> 'resource_id')::uuid end;
        if not found or v_resource.venue_id <> p_zone.venue_id then
          v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'unknown_table');
        elsif v_resource.zone_id is distinct from p_zone.id then
          v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'table_in_other_area', 'label', v_resource.label);
        elsif v_resource.status = 'RETIRED' then
          v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'table_retired', 'label', v_resource.label);
        elsif v_resource.id = any (v_seen) then
          v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'duplicate_table', 'label', v_resource.label);
        else
          v_seen := v_seen || v_resource.id;
          if exists (
            select 1 from jsonb_array_elements(v_boxes) b
            where v_x < (b ->> 'x')::integer + (b ->> 'w')::integer and (b ->> 'x')::integer < v_x + (v_box ->> 'w')::integer
              and v_y < (b ->> 'y')::integer + (b ->> 'h')::integer and (b ->> 'y')::integer < v_y + (v_box ->> 'h')::integer
          ) then
            v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'overlaps_table', 'label', v_resource.label);
          end if;
          v_boxes := v_boxes || v_box;
        end if;
      elsif v_el ? 'resource_id' and v_el ->> 'resource_id' is not null then
        v_problems := v_problems || jsonb_build_object('index', v_i, 'code', 'table_reference_on_fixture');
      end if;
    end if;
    v_i := v_i + 1;
  end loop;
  return v_problems;
end;
$$;

create or replace function app.layout_json(p_layout public.floor_layouts, p_public boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_layout.id, 'layout_version', p_layout.layout_version, 'status', p_layout.status, 'width', p_layout.width,
    'height', p_layout.height, 'published_at', p_layout.published_at, 'version', p_layout.version,
    'elements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', e.element_type, 'resource_id', e.resource_id, 'label', coalesce(e.label, r.label), 'x', e.x, 'y', e.y,
               'width', e.width, 'height', e.height, 'rotation', e.rotation,
               'table', case when r.id is null then null else jsonb_build_object(
                 'label', r.label, 'capacity', r.capacity, 'shape', r.shape, 'features', to_jsonb(r.features),
                 'bookable', r.status = 'ACTIVE' and r.operational_state <> 'OUT_OF_SERVICE',
                 'hourly_paise', app.current_hourly_paise(r.id),
                 'photo', (select jsonb_build_object('id', m.id, 'alt_text', m.alt_text) from public.venue_media m
                           where m.id = r.photo_media_id and m.status = 'APPROVED' and m.kind = 'PHOTO')) end)
             order by e.sort_order, e.id)
      from public.layout_elements e left join public.resources r on r.id = e.resource_id
      where e.layout_id = p_layout.id and (not p_public or e.element_type <> 'TABLE' or r.status <> 'RETIRED')), '[]'::jsonb));
$$;

-- Partner: areas -----------------------------------------------------------------------------------------------------------
create or replace function app.check_zone_fields(p_name text, p_kind text, p_floor_level integer, p_features text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_name is not null and char_length(trim(p_name)) not between 1 and 60 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'name'));
  end if;
  if p_kind is not null and p_kind not in ('INDOOR', 'OUTDOOR', 'ROOFTOP', 'PRIVATE_ROOM') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'kind'));
  end if;
  if p_floor_level is not null and p_floor_level not between -2 and 20 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'floor_level'));
  end if;
  if p_features is not null and not (p_features <@ array['AIR_CONDITIONED', 'COVERED', 'QUIET', 'SMOKING_ALLOWED', 'PET_FRIENDLY', 'STEP_FREE']::text[]) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'features'));
  end if;
end;
$$;

create or replace function app.partner_create_zone(
  p_venue_id uuid, p_name text, p_kind text, p_floor_level integer, p_features text[], p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_manager(p_venue_id);
  v_zone public.venue_zones;
begin
  if p_name is null then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'name'));
  end if;
  perform app.check_zone_fields(p_name, p_kind, p_floor_level, p_features);
  perform 1 from public.venues where id = p_venue_id and status <> 'REJECTED' for update;
  if not found then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', 'REJECTED'));
  end if;
  if exists (select 1 from public.venue_zones where venue_id = p_venue_id and status = 'ACTIVE' and lower(name) = lower(trim(p_name))) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'name', 'reason', 'duplicate'));
  end if;
  if (select count(*) from public.venue_zones where venue_id = p_venue_id and status = 'ACTIVE') >= 20 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'name', 'reason', 'too_many_areas'));
  end if;
  insert into public.venue_zones (venue_id, name, kind, floor_level, features, sort_order)
  values (p_venue_id, trim(p_name), coalesce(p_kind, 'INDOOR'), coalesce(p_floor_level, 0), coalesce(p_features, '{}'),
          coalesce((select max(sort_order) + 1 from public.venue_zones where venue_id = p_venue_id and status = 'ACTIVE'), 0))
  returning * into v_zone;
  perform app.audit(v_actor, app.manager_role(p_venue_id), 'zone.create', 'venue_zone', v_zone.id, p_venue_id, p_request_id, null,
                    jsonb_build_object('kind', v_zone.kind, 'floor_level', v_zone.floor_level));
  return app.zone_json(v_zone);
end;
$$;

create or replace function app.partner_update_zone(
  p_zone_id uuid, p_name text, p_kind text, p_floor_level integer, p_features text[], p_sort_order integer,
  p_expected_version integer, p_request_id uuid default null
)
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
  perform app.check_zone_fields(p_name, p_kind, p_floor_level, p_features);
  if p_sort_order is not null and p_sort_order not between 0 and 99 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'sort_order'));
  end if;
  if p_name is not null and exists (select 1 from public.venue_zones where venue_id = v_zone.venue_id and status = 'ACTIVE'
                                    and id <> p_zone_id and lower(name) = lower(trim(p_name))) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'name', 'reason', 'duplicate'));
  end if;
  update public.venue_zones set name = coalesce(trim(p_name), name), kind = coalesce(p_kind, kind),
         floor_level = coalesce(p_floor_level, floor_level), features = coalesce(p_features, features),
         sort_order = coalesce(p_sort_order, sort_order)
  where id = p_zone_id returning * into v_zone;
  perform app.audit(v_actor, app.manager_role(v_zone.venue_id), 'zone.update', 'venue_zone', p_zone_id, v_zone.venue_id, p_request_id, null);
  return app.zone_json(v_zone);
end;
$$;

-- Archiving needs an empty area: move or retire its tables first. Its published layout is archived, its draft dropped.
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
  update public.venue_zones set status = 'ARCHIVED' where id = p_zone_id returning * into v_zone;
  perform app.audit(v_actor, app.manager_role(v_zone.venue_id), 'zone.archive', 'venue_zone', p_zone_id, v_zone.venue_id, p_request_id, null);
  return app.zone_json(v_zone);
end;
$$;

-- Partner: table details (area, shape, features, photo). A table can change area only while no layout of another
-- area shows it; remove it from that drawing (and publish) first. The photo must be an approved photo of the venue.
create or replace function app.partner_set_table_details(
  p_resource_id uuid, p_zone_id uuid, p_clear_zone boolean, p_shape text, p_features text[], p_photo_media_id uuid,
  p_clear_photo boolean, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_resource public.resources := app.lock_partner_resource(p_resource_id);
  v_zone_id uuid;
begin
  if v_resource.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_resource.version));
  end if;
  if v_resource.status = 'RETIRED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_resource.status));
  end if;
  if p_shape is not null and p_shape not in ('ROUND', 'SQUARE', 'RECTANGLE', 'BAR_STOOL', 'SOFA') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'shape'));
  end if;
  if p_features is not null and not (p_features <@ array['WINDOW', 'POWER_SOCKET', 'AIR_CONDITIONED', 'SOFA_SEATING', 'STEP_FREE', 'QUIET', 'VIEW']::text[]) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'features'));
  end if;
  v_zone_id := case when coalesce(p_clear_zone, false) then null else coalesce(p_zone_id, v_resource.zone_id) end;
  if v_zone_id is not null and not exists (
    select 1 from public.venue_zones where id = v_zone_id and venue_id = v_resource.venue_id and status = 'ACTIVE') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'zone_id'));
  end if;
  if v_zone_id is distinct from v_resource.zone_id and exists (
    select 1 from public.layout_elements e join public.floor_layouts l on l.id = e.layout_id
    where e.resource_id = p_resource_id and l.status in ('DRAFT', 'PUBLISHED')) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'table_on_floor_plan'));
  end if;
  if p_photo_media_id is not null and not exists (
    select 1 from public.venue_media where id = p_photo_media_id and venue_id = v_resource.venue_id and kind = 'PHOTO' and status = 'APPROVED') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'photo_media_id'));
  end if;
  update public.resources set
    zone_id = v_zone_id,
    shape = coalesce(p_shape, shape),
    features = coalesce(p_features, features),
    photo_media_id = case when coalesce(p_clear_photo, false) then null else coalesce(p_photo_media_id, photo_media_id) end
  where id = p_resource_id returning * into v_resource;
  perform app.audit(v_actor, app.manager_role(v_resource.venue_id), 'resource.details', 'resource', p_resource_id, v_resource.venue_id,
                    p_request_id, null, jsonb_build_object('zone_id', v_resource.zone_id, 'shape', v_resource.shape));
  return jsonb_build_object('resource_id', v_resource.id, 'zone_id', v_resource.zone_id, 'shape', v_resource.shape,
                            'features', to_jsonb(v_resource.features), 'photo_media_id', v_resource.photo_media_id,
                            'version', v_resource.version);
end;
$$;

-- Partner: floor layouts ------------------------------------------------------------------------------------------------------
-- Replaces the area's draft drawing (creating the draft when there is none). Invalid drawings are refused whole,
-- with every problem listed. p_expected_version is the draft's version (null when creating the first draft).
create or replace function app.partner_save_layout_draft(
  p_zone_id uuid, p_width integer, p_height integer, p_elements jsonb, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone public.venue_zones;
  v_actor uuid;
  v_layout public.floor_layouts;
  v_problems jsonb;
  v_el jsonb;
  v_i integer := 0;
begin
  select * into v_zone from public.venue_zones where id = p_zone_id;
  v_actor := app.require_venue_manager(v_zone.venue_id);
  select * into v_zone from public.venue_zones where id = p_zone_id for update;
  if v_zone.status <> 'ACTIVE' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_zone.status));
  end if;
  select * into v_layout from public.floor_layouts where zone_id = p_zone_id and status = 'DRAFT' for update;
  if found and (p_expected_version is null or v_layout.version <> p_expected_version) then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_layout.version));
  end if;
  if not found and p_expected_version is not null then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', null));
  end if;
  v_problems := app.layout_problems(v_zone, p_width, p_height, p_elements);
  if jsonb_array_length(v_problems) > 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'elements', 'problems', v_problems));
  end if;
  if v_layout.id is null then
    insert into public.floor_layouts (zone_id, venue_id, layout_version, width, height)
    values (p_zone_id, v_zone.venue_id,
            coalesce((select max(layout_version) from public.floor_layouts where zone_id = p_zone_id), 0) + 1, p_width, p_height)
    returning * into v_layout;
  else
    delete from public.layout_elements where layout_id = v_layout.id;
    update public.floor_layouts set width = p_width, height = p_height where id = v_layout.id returning * into v_layout;
  end if;
  for v_el in select value from jsonb_array_elements(p_elements) loop
    insert into public.layout_elements (layout_id, element_type, resource_id, label, x, y, width, height, rotation, sort_order)
    values (v_layout.id, v_el ->> 'type', nullif(v_el ->> 'resource_id', '')::uuid, nullif(trim(v_el ->> 'label'), ''),
            (v_el ->> 'x')::integer, (v_el ->> 'y')::integer, (v_el ->> 'width')::integer, (v_el ->> 'height')::integer,
            coalesce((v_el ->> 'rotation')::integer, 0), v_i);
    v_i := v_i + 1;
  end loop;
  perform app.audit(v_actor, app.manager_role(v_zone.venue_id), 'layout.save_draft', 'floor_layout', v_layout.id, v_zone.venue_id,
                    p_request_id, null, jsonb_build_object('elements', v_i, 'layout_version', v_layout.layout_version));
  return app.layout_json(v_layout, false);
end;
$$;

-- Publishes the area's draft: re-validates it (tables may have changed since), requires at least one table and a current
-- price for every placed table, then archives the previous published version. Bookings are not touched.
create or replace function app.partner_publish_layout(p_zone_id uuid, p_expected_version integer, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone public.venue_zones;
  v_actor uuid;
  v_layout public.floor_layouts;
  v_elements jsonb;
  v_problems jsonb;
  v_unpriced jsonb;
begin
  select * into v_zone from public.venue_zones where id = p_zone_id;
  v_actor := app.require_venue_manager(v_zone.venue_id);
  select * into v_zone from public.venue_zones where id = p_zone_id for update;
  select * into v_layout from public.floor_layouts where zone_id = p_zone_id and status = 'DRAFT' for update;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  if v_layout.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_layout.version));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('type', e.element_type, 'resource_id', e.resource_id, 'label', e.label, 'x', e.x,
                                               'y', e.y, 'width', e.width, 'height', e.height, 'rotation', e.rotation)
                            order by e.sort_order), '[]'::jsonb)
  into v_elements from public.layout_elements e where e.layout_id = v_layout.id;
  v_problems := app.layout_problems(v_zone, v_layout.width, v_layout.height, v_elements);
  if jsonb_array_length(v_problems) > 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'elements', 'problems', v_problems));
  end if;
  if not exists (select 1 from public.layout_elements where layout_id = v_layout.id and element_type = 'TABLE') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'elements', 'reason', 'no_tables'));
  end if;
  select coalesce(jsonb_agg(r.label order by r.label), '[]'::jsonb) into v_unpriced
  from public.layout_elements e join public.resources r on r.id = e.resource_id
  where e.layout_id = v_layout.id and app.current_hourly_paise(r.id) is null;
  if jsonb_array_length(v_unpriced) > 0 then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'rate', 'tables', v_unpriced));
  end if;
  update public.floor_layouts set status = 'ARCHIVED' where zone_id = p_zone_id and status = 'PUBLISHED';
  update public.floor_layouts set status = 'PUBLISHED', published_at = now(), published_by = v_actor
  where id = v_layout.id returning * into v_layout;
  perform app.audit(v_actor, app.manager_role(v_zone.venue_id), 'layout.publish', 'floor_layout', v_layout.id, v_zone.venue_id,
                    p_request_id, null, jsonb_build_object('layout_version', v_layout.layout_version,
                                                           'elements', jsonb_array_length(v_elements)));
  return app.layout_json(v_layout, false);
end;
$$;

-- Partner: area price. Writes a new rate version (same rules as app.partner_set_rate) for every active or paused table
-- in the area, from now or a future instant. With p_keep_custom, tables whose current price differs from the area's
-- previous default keep their own price. Quotes and bookings already made keep their snapshot.
create or replace function app.partner_set_zone_price(
  p_zone_id uuid, p_hourly_paise bigint, p_effective_from timestamptz, p_keep_custom boolean, p_expected_version integer,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone public.venue_zones;
  v_actor uuid;
  v_from timestamptz := greatest(coalesce(p_effective_from, clock_timestamp()), clock_timestamp());
  v_fee text := app.current_fee_config_version();
  v_resource public.resources;
  v_open public.resource_rates;
  v_updated jsonb := '[]'::jsonb;
  v_kept jsonb := '[]'::jsonb;
begin
  select * into v_zone from public.venue_zones where id = p_zone_id;
  v_actor := app.require_venue_manager(v_zone.venue_id);
  perform app.lock_venue_inventory(v_zone.venue_id);
  select * into v_zone from public.venue_zones where id = p_zone_id for update;
  if v_zone.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_zone.version));
  end if;
  if v_zone.status <> 'ACTIVE' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_zone.status));
  end if;
  if p_hourly_paise is null or p_hourly_paise not between 100 and 10000000 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'hourly_paise'));
  end if;
  if p_effective_from is not null and p_effective_from < clock_timestamp() - interval '1 minute' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'effective_from', 'reason', 'past'));
  end if;
  if v_fee is null then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'fee_configuration'));
  end if;
  for v_resource in select * from public.resources where zone_id = p_zone_id and status <> 'RETIRED' order by label loop
    select * into v_open from public.resource_rates where resource_id = v_resource.id and effective_to is null for update;
    if coalesce(p_keep_custom, true) and v_zone.default_hourly_paise is not null and v_open.id is not null
       and v_open.hourly_paise <> v_zone.default_hourly_paise then
      v_kept := v_kept || jsonb_build_object('resource_id', v_resource.id, 'label', v_resource.label, 'hourly_paise', v_open.hourly_paise);
      continue;
    end if;
    if v_open.id is not null and v_open.effective_from >= v_from then
      perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'future_rate_pending', 'label', v_resource.label));
    end if;
    if v_open.id is not null and v_open.hourly_paise = p_hourly_paise then
      v_updated := v_updated || jsonb_build_object('resource_id', v_resource.id, 'label', v_resource.label, 'unchanged', true);
      continue;
    end if;
    if v_open.id is not null then
      update public.resource_rates set effective_to = v_from where id = v_open.id;
    end if;
    insert into public.resource_rates (resource_id, rate_version, hourly_paise, effective_from, fee_config_version)
    values (v_resource.id, coalesce((select max(rate_version) from public.resource_rates where resource_id = v_resource.id), 0) + 1,
            p_hourly_paise, v_from, v_fee);
    update public.resources set updated_at = now() where id = v_resource.id;
    v_updated := v_updated || jsonb_build_object('resource_id', v_resource.id, 'label', v_resource.label, 'unchanged', false);
  end loop;
  update public.venue_zones set default_hourly_paise = p_hourly_paise where id = p_zone_id returning * into v_zone;
  perform app.audit(v_actor, app.manager_role(v_zone.venue_id), 'zone.price', 'venue_zone', p_zone_id, v_zone.venue_id, p_request_id,
                    null, jsonb_build_object('hourly_paise', p_hourly_paise, 'effective_from', v_from,
                                             'tables', jsonb_array_length(v_updated), 'kept', jsonb_array_length(v_kept)));
  return jsonb_build_object('zone', app.zone_json(v_zone), 'effective_from', v_from, 'updated', v_updated, 'kept_custom', v_kept);
end;
$$;

-- Partner: everything the floor editor needs for one venue (areas, both layout versions, tables with their details).
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
      from public.resources r where r.venue_id = p_venue_id and r.status <> 'RETIRED'), '[]'::jsonb));
end;
$$;

-- Public: published areas and their published drawings for a published venue ------------------------------------------------
create or replace function app.venue_seating(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue public.venues;
begin
  select * into v_venue from public.venues where id = p_venue_id and status = 'PUBLISHED';
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  return jsonb_build_object(
    'venue_id', v_venue.id,
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', z.id, 'name', z.name, 'kind', z.kind, 'floor_level', z.floor_level, 'features', to_jsonb(z.features),
               'from_hourly_paise', (select min(app.current_hourly_paise(r.id)) from public.resources r
                                     where r.zone_id = z.id and r.status = 'ACTIVE'),
               'table_count', (select count(*) from public.resources r where r.zone_id = z.id and r.status = 'ACTIVE'),
               'layout', (select app.layout_json(l, true) - 'status' - 'version' from public.floor_layouts l
                          where l.zone_id = z.id and l.status = 'PUBLISHED'))
             order by z.sort_order, z.name)
      from public.venue_zones z where z.venue_id = v_venue.id and z.status = 'ACTIVE'
        and exists (select 1 from public.resources r where r.zone_id = z.id and r.status = 'ACTIVE')), '[]'::jsonb),
    'unzoned_table_count', (select count(*) from public.resources r where r.venue_id = v_venue.id and r.status = 'ACTIVE' and r.zone_id is null));
end;
$$;

-- Public: each active table's state for one start time, duration and party (FREE, BOOKED, TOO_SMALL, UNAVAILABLE).
-- Advisory like app.venue_day_availability; the hold is the only commitment. Never says who booked or why.
create or replace function app.venue_seat_map(p_venue_id uuid, p_start_at timestamptz, p_duration_minutes integer, p_party_size integer)
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
  v_party integer := greatest(1, coalesce(p_party_size, 1));
  v_end timestamptz;
  v_tables jsonb;
begin
  select * into v_venue from public.venues where id = p_venue_id and status = 'PUBLISHED';
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  select * into v_policy from public.venue_policies where id = v_venue.active_policy_id and status = 'PUBLISHED';
  if not found then
    perform app.fail('POLICY_NOT_CONFIGURED', jsonb_build_object('field', 'policy'));
  end if;
  if p_start_at is null then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'start_at'));
  end if;
  if p_duration_minutes is null or p_duration_minutes < v_policy.minimum_minutes or p_duration_minutes > v_policy.maximum_minutes
     or p_duration_minutes % v_policy.increment_minutes <> 0 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object(
      'field', 'duration_minutes', 'minimum_minutes', v_policy.minimum_minutes,
      'maximum_minutes', v_policy.maximum_minutes, 'increment_minutes', v_policy.increment_minutes));
  end if;
  v_end := p_start_at + make_interval(mins => p_duration_minutes);
  select coalesce(jsonb_agg(t.item order by t.label), '[]'::jsonb) into v_tables
  from (
    select r.label, jsonb_build_object(
      'resource_id', r.id, 'label', r.label, 'zone_id', r.zone_id, 'capacity', r.capacity,
      'state', s.state, 'reason', s.reason,
      'price', app.price_for(r.id, p_start_at, p_duration_minutes)) as item
    from public.resources r
    cross join lateral (
      select case
               when r.capacity < v_party then 'TOO_SMALL'
               when app.is_blocked(r.id, p_start_at, v_end + make_interval(mins => v_policy.buffer_minutes), v_now) then 'BOOKED'
               when p.problem is not null then 'UNAVAILABLE'
               else 'FREE' end as state,
             case when r.capacity >= v_party
                       and not app.is_blocked(r.id, p_start_at, v_end + make_interval(mins => v_policy.buffer_minutes), v_now)
                  then p.problem ->> 'code' end as reason
      from (select app.slot_problem(v_venue, r, v_policy, p_start_at, v_end, v_party, v_now) as problem) p
    ) s
    where r.venue_id = v_venue.id and r.status = 'ACTIVE'
  ) t;
  return jsonb_build_object('venue_id', v_venue.id, 'start_at', p_start_at, 'end_at', v_end, 'duration_minutes', p_duration_minutes,
                            'party_size', v_party, 'tables', v_tables, 'checked_at', v_now);
end;
$$;

grant execute on function app.partner_create_zone(uuid, text, text, integer, text[], uuid) to authenticated;
grant execute on function app.partner_update_zone(uuid, text, text, integer, text[], integer, integer, uuid) to authenticated;
grant execute on function app.partner_archive_zone(uuid, integer, uuid) to authenticated;
grant execute on function app.partner_set_table_details(uuid, uuid, boolean, text, text[], uuid, boolean, integer, uuid) to authenticated;
grant execute on function app.partner_save_layout_draft(uuid, integer, integer, jsonb, integer, uuid) to authenticated;
grant execute on function app.partner_publish_layout(uuid, integer, uuid) to authenticated;
grant execute on function app.partner_set_zone_price(uuid, bigint, timestamptz, boolean, integer, uuid) to authenticated;
grant execute on function app.partner_seating(uuid) to authenticated;
grant execute on function app.venue_seating(uuid) to anon, authenticated;
grant execute on function app.venue_seat_map(uuid, timestamptz, integer, integer) to anon, authenticated;
-- Internal: zone_json, layout_json, layout_problems, current_hourly_paise, check_zone_fields, guard_* (triggers).
revoke execute on all functions in schema app from public;
