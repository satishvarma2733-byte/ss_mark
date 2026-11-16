-- M2 foundation: extensions, private domain schema, worker role, default privileges and shared triggers.
-- Forward-only. Rollback before any shared environment: delete migrations and `supabase db reset` locally.

create extension if not exists btree_gist with schema extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Domain functions live in `app`. PostgREST exposes only `public` and `graphql_public` (supabase/config.toml),
-- so clients holding the publishable key cannot call these functions directly; the trusted API does.
create schema if not exists app;
comment on schema app is 'Private domain functions for the trusted API and worker. Not exposed through PostgREST.';
revoke all on schema app from public;
-- Helper functions in `app` are referenced by RLS policies, so request roles need USAGE (EXECUTE is granted per function).
grant usage on schema app to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'simply_worker') then
    create role simply_worker nologin;
  end if;
end
$$;
comment on role simply_worker is 'Background worker. The API connection switches to it with SET LOCAL ROLE; grants are explicit per function.';
grant usage on schema app, public to simply_worker;
grant simply_worker to postgres;

-- Supabase grants ALL on new public objects to anon/authenticated by default. Clients must only ever receive explicit,
-- reviewed SELECT grants (see the RLS migration), so remove those defaults for objects created by this role.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;
-- Note: a per-schema default cannot remove PostgreSQL's global PUBLIC EXECUTE default for functions; the RLS migration
-- revokes it explicitly with `revoke execute on all functions in schema app from public`.
alter default privileges for role postgres in schema app revoke all on functions from public;

-- Raises a stable domain error. The message is the code from docs/07 s.1; detail is safe JSON for the client.
create or replace function app.fail(p_code text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = p_detail::text;
end;
$$;

-- Maintains updated_at and the optimistic-concurrency version on every mutable table.
create or replace function app.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

-- Guards append-only and never-delete tables.
create or replace function app.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', tg_table_name, 'operation', tg_op));
  return null;
end;
$$;

create or replace function app.is_valid_timezone(p_zone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone);
$$;

-- Integer half-up division for non-negative paise arithmetic (schema: "rounding is deterministic and tested").
create or replace function app.div_half_up(p_numerator bigint, p_denominator bigint)
returns bigint
language sql
immutable
strict
set search_path = ''
as $$
  select (p_numerator + p_denominator / 2) / p_denominator;
$$;

-- Opaque public booking reference, e.g. SS-7KQ2M9XHPA. Alphabet avoids ambiguous characters.
create or replace function app.new_public_ref()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_ref text := 'SS-';
begin
  for i in 0..9 loop
    v_ref := v_ref || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  return v_ref;
end;
$$;
