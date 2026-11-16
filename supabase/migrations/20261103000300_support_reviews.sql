-- M4.5 support and reviews (docs/03 C12, C13, A03a, A03, A04; docs/05 reviews, support_tickets; docs/07 s.3, s.4;
-- docs/08 T14, T15). Reporters see only their own tickets and the customer-visible resolution; private notes never
-- leave support. Confidential tickets: superadmins and the assigned support admin only. Contact details are revealed
-- per ticket with a reason (audited). Venue pages show published reviews only.

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique,
  venue_id uuid not null references public.venues (id),
  customer_id uuid not null references public.profiles (id),
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) between 1 and 2000),
  moderation_status text not null default 'PENDING' check (moderation_status in ('PENDING', 'PUBLISHED', 'HIDDEN')),
  moderation_reason text check (moderation_reason is null or char_length(moderation_reason) between 3 and 500),
  moderated_by uuid references public.profiles (id),
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint reviews_booking_fk foreign key (booking_id, venue_id) references public.bookings (id, venue_id)
);
create index reviews_venue_idx on public.reviews (venue_id, moderation_status, created_at desc);
create index reviews_queue_idx on public.reviews (moderation_status, created_at);
create trigger reviews_touch before update on public.reviews for each row execute function app.touch_row();
alter table public.reviews enable row level security;
alter table public.reviews force row level security;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique check (public_ref ~ '^ST-[A-HJ-KM-NP-Z2-9]{8}$'),
  reporter_id uuid not null references public.profiles (id),
  reporter_role text not null check (reporter_role in ('CUSTOMER', 'VENUE_STAFF')),
  booking_id uuid references public.bookings (id),
  venue_id uuid references public.venues (id),
  category text not null check (category in ('BOOKING', 'PAYMENT', 'REFUND', 'VENUE', 'SAFETY', 'ACCOUNT', 'OTHER')),
  priority text not null default 'NORMAL' check (priority in ('NORMAL', 'HIGH', 'URGENT')),
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  description text not null check (char_length(description) between 10 and 5000),
  is_sensitive boolean not null default false,
  assigned_admin_id uuid references public.profiles (id),
  customer_visible_resolution text check (customer_visible_resolution is null or char_length(customer_visible_resolution) between 3 and 2000),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index support_tickets_reporter_idx on public.support_tickets (reporter_id, created_at desc);
create index support_tickets_queue_idx on public.support_tickets (status, priority, created_at);
create trigger support_tickets_touch before update on public.support_tickets for each row execute function app.touch_row();
alter table public.support_tickets enable row level security;
alter table public.support_tickets force row level security;

-- Private investigation notes: append-only, support only.
create table public.ticket_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id),
  author_id uuid not null references public.profiles (id),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index ticket_notes_ticket_idx on public.ticket_notes (ticket_id, created_at);
create trigger ticket_notes_append_only before update or delete on public.ticket_notes for each row execute function app.forbid_change();
alter table public.ticket_notes enable row level security;
alter table public.ticket_notes force row level security;

create or replace function app.new_ticket_ref()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'ST-' || string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 31) + 1, 1), '')
  from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) as i;
$$;

-- Reviews ---------------------------------------------------------------------------------------------------------
create or replace function app.review_json(p_review public.reviews)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('review_id', p_review.id, 'booking_id', p_review.booking_id, 'rating', p_review.rating,
                            'body', p_review.body, 'moderation_status', p_review.moderation_status,
                            'created_at', p_review.created_at, 'version', p_review.version);
$$;

-- POST /bookings/{id}/reviews: once, by the customer, after the booking is COMPLETED.
create or replace function app.create_review(p_booking_id uuid, p_rating integer, p_body text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_booking public.bookings;
  v_review public.reviews;
begin
  select * into v_booking from public.bookings where id = p_booking_id and customer_id = v_actor;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  if v_booking.status <> 'COMPLETED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_booking.status, 'reason', 'not_completed'));
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'rating'));
  end if;
  if p_body is not null and char_length(trim(p_body)) > 2000 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'body'));
  end if;
  if exists (select 1 from public.reviews where booking_id = p_booking_id) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'already_reviewed'));
  end if;
  insert into public.reviews (booking_id, venue_id, customer_id, rating, body)
  values (p_booking_id, v_booking.venue_id, v_actor, p_rating, nullif(trim(p_body), ''))
  returning * into v_review;
  return app.review_json(v_review);
end;
$$;

create or replace function app.moderate_review(
  p_review_id uuid, p_decision text, p_reason text, p_expected_version integer, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
  v_review public.reviews;
begin
  select * into v_review from public.reviews where id = p_review_id for update;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  if v_review.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_review.version));
  end if;
  if p_decision not in ('PUBLISH', 'HIDE') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'decision'));
  end if;
  if p_decision = 'HIDE' and (p_reason is null or char_length(trim(p_reason)) not between 3 and 500) then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  update public.reviews
     set moderation_status = case when p_decision = 'PUBLISH' then 'PUBLISHED' else 'HIDDEN' end,
         moderation_reason = nullif(trim(coalesce(p_reason, '')), ''), moderated_by = v_actor, moderated_at = now()
   where id = p_review_id returning * into v_review;
  perform app.audit(v_actor, 'PLATFORM_ADMIN', 'review.moderate', 'review', p_review_id, v_review.venue_id, p_request_id,
                    nullif(trim(coalesce(p_reason, '')), ''), jsonb_build_object('decision', p_decision));
  return app.review_json(v_review);
end;
$$;

create or replace function app.admin_review_queue(p_status text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
begin
  if p_status not in ('PENDING', 'PUBLISHED', 'HIDDEN') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'status'));
  end if;
  return coalesce((
    select jsonb_agg(app.review_json(r) || jsonb_build_object('venue_name', v.name, 'moderation_reason', r.moderation_reason)
                     order by r.created_at)
    from (select * from public.reviews where moderation_status = p_status order by created_at limit 200) r
    join public.venues v on v.id = r.venue_id), '[]'::jsonb);
end;
$$;

-- Public: published reviews of a published venue (no names, month only) and the summary.
create or replace function app.venue_reviews(p_venue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*),
    'average', round(avg(r.rating)::numeric, 1),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('rating', x.rating, 'body', x.body, 'month', to_char(x.created_at, 'YYYY-MM'))
                                         order by x.created_at desc)
                        from (select rating, body, created_at from public.reviews
                              where venue_id = p_venue_id and moderation_status = 'PUBLISHED' order by created_at desc limit 10) x), '[]'::jsonb))
  from public.reviews r join public.venues v on v.id = r.venue_id
  where r.venue_id = p_venue_id and r.moderation_status = 'PUBLISHED' and v.status = 'PUBLISHED';
$$;

-- Tickets ---------------------------------------------------------------------------------------------------------
create or replace function app.ticket_json(p_ticket public.support_tickets)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ticket_id', p_ticket.id, 'public_ref', p_ticket.public_ref, 'category', p_ticket.category, 'status', p_ticket.status,
    'priority', p_ticket.priority, 'description', p_ticket.description, 'is_sensitive', p_ticket.is_sensitive,
    'booking_ref', (select b.public_ref from public.bookings b where b.id = p_ticket.booking_id),
    'venue_name', (select v.name from public.venues v where v.id = p_ticket.venue_id),
    'customer_visible_resolution', p_ticket.customer_visible_resolution, 'resolved_at', p_ticket.resolved_at,
    'created_at', p_ticket.created_at, 'updated_at', p_ticket.updated_at, 'version', p_ticket.version);
$$;

create or replace function app.insert_ticket(
  p_actor uuid, p_role text, p_booking_id uuid, p_venue_id uuid, p_category text, p_description text, p_sensitive boolean
)
returns public.support_tickets
language plpgsql
set search_path = ''
as $$
declare
  v_ticket public.support_tickets;
begin
  if p_category is null or p_category not in ('BOOKING', 'PAYMENT', 'REFUND', 'VENUE', 'SAFETY', 'ACCOUNT', 'OTHER') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'category'));
  end if;
  if p_description is null or char_length(trim(p_description)) not between 10 and 5000 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'description'));
  end if;
  if (select count(*) from public.support_tickets where reporter_id = p_actor and status in ('OPEN', 'IN_PROGRESS')) >= 10 then
    perform app.fail('RATE_LIMITED', jsonb_build_object('reason', 'too_many_open_tickets'));
  end if;
  insert into public.support_tickets (public_ref, reporter_id, reporter_role, booking_id, venue_id, category, priority, description, is_sensitive)
  values (app.new_ticket_ref(), p_actor, p_role, p_booking_id, p_venue_id, p_category,
          case when p_category = 'SAFETY' then 'HIGH' else 'NORMAL' end, trim(p_description),
          coalesce(p_sensitive, false) or p_category = 'SAFETY')
  returning * into v_ticket;
  return v_ticket;
end;
$$;

-- POST /support-tickets (customer). A linked booking must be the customer's own.
create or replace function app.create_ticket(p_booking_id uuid, p_category text, p_description text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_venue uuid;
  v_ticket public.support_tickets;
begin
  if p_booking_id is not null then
    select venue_id into v_venue from public.bookings where id = p_booking_id and customer_id = v_actor;
    if not found then
      perform app.fail('NOT_FOUND', jsonb_build_object('field', 'booking_id'));
    end if;
  end if;
  v_ticket := app.insert_ticket(v_actor, 'CUSTOMER', p_booking_id, v_venue, p_category, p_description, false);
  return app.ticket_json(v_ticket);
end;
$$;

-- POST /partner/incidents (assigned staff with TOTP): an incident at their venue, optionally about one booking there.
create or replace function app.staff_report_incident(
  p_venue_id uuid, p_booking_id uuid, p_category text, p_description text, p_sensitive boolean, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_venue_staff(p_venue_id);
  v_ticket public.support_tickets;
begin
  if p_booking_id is not null and not exists (select 1 from public.bookings where id = p_booking_id and venue_id = p_venue_id) then
    perform app.fail('NOT_FOUND', jsonb_build_object('field', 'booking_id'));
  end if;
  v_ticket := app.insert_ticket(v_actor, 'VENUE_STAFF', p_booking_id, p_venue_id, p_category, p_description, p_sensitive);
  perform app.audit(v_actor, 'VENUE_STAFF', 'incident.report', 'support_ticket', v_ticket.id, p_venue_id, p_request_id, null,
                    jsonb_build_object('category', p_category, 'sensitive', v_ticket.is_sensitive));
  return app.ticket_json(v_ticket);
end;
$$;

create or replace function app.my_tickets()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
begin
  return coalesce((select jsonb_agg(app.ticket_json(t) order by t.created_at desc)
                   from (select * from public.support_tickets where reporter_id = v_actor order by created_at desc limit 50) t), '[]'::jsonb);
end;
$$;

create or replace function app.my_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_ticket public.support_tickets;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id and reporter_id = v_actor;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  return app.ticket_json(v_ticket);
end;
$$;

-- Support may see a ticket: confidential ones only by superadmins and the assigned admin. Always true or false (an
-- unassigned ticket's NULL assignee must not turn the answer into NULL, which callers' "not ..." would let through).
create or replace function app.can_see_ticket(p_ticket public.support_tickets, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.has_platform_role(array['SUPERADMIN'])
      or (app.has_platform_role(array['SUPPORT'])
          and (not p_ticket.is_sensitive or coalesce(p_ticket.assigned_admin_id = p_actor, false))),
    false);
$$;

create or replace function app.admin_ticket_queue(p_status text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
begin
  if p_status not in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'status'));
  end if;
  return jsonb_build_object(
    'tickets', coalesce((
      select jsonb_agg(app.ticket_json(t) || jsonb_build_object('reporter_role', t.reporter_role, 'assigned_to_me', t.assigned_admin_id = v_actor)
                       order by case t.priority when 'URGENT' then 0 when 'HIGH' then 1 else 2 end, t.created_at)
      from (select * from public.support_tickets where status = p_status order by created_at limit 300) t
      where app.can_see_ticket(t, v_actor)), '[]'::jsonb),
    -- Confidential tickets this admin cannot open are counted so they are not silently missed.
    'restricted_count', (select count(*) from public.support_tickets t where t.status = p_status and not app.can_see_ticket(t, v_actor)));
end;
$$;

create or replace function app.admin_ticket_detail(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
  v_ticket public.support_tickets;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if not found or not app.can_see_ticket(v_ticket, v_actor) then
    perform app.fail('NOT_FOUND');
  end if;
  return app.ticket_json(v_ticket) || jsonb_build_object(
    'reporter_role', v_ticket.reporter_role,
    'booking_id', v_ticket.booking_id,
    'assigned_to_me', v_ticket.assigned_admin_id = v_actor,
    'assigned', v_ticket.assigned_admin_id is not null,
    'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'at', n.created_at, 'by_me', n.author_id = v_actor) order by n.created_at)
                       from public.ticket_notes n where n.ticket_id = p_ticket_id), '[]'::jsonb),
    'support_admins', case when app.has_platform_role(array['SUPERADMIN']) then coalesce((
        select jsonb_agg(jsonb_build_object('profile_id', p.id, 'label', coalesce(p.display_name, 'Support admin')))
        from public.platform_memberships pm join public.profiles p on p.id = pm.user_id
        where pm.role = 'SUPPORT' and pm.status = 'ACTIVE'), '[]'::jsonb) end);
end;
$$;

-- PATCH /admin/support-tickets/{id}: triage with audit. Assigning a confidential ticket to someone else is for
-- superadmins; support can take a non-confidential ticket themselves.
create or replace function app.admin_update_ticket(
  p_ticket_id uuid, p_status text, p_priority text, p_assign_to uuid, p_resolution text, p_note text, p_expected_version integer,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
  v_ticket public.support_tickets;
  v_super boolean := app.has_platform_role(array['SUPERADMIN']);
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found or not app.can_see_ticket(v_ticket, v_actor) then
    perform app.fail('NOT_FOUND');
  end if;
  if v_ticket.version <> p_expected_version then
    perform app.fail('STALE_VERSION', jsonb_build_object('current_version', v_ticket.version));
  end if;
  if p_status is not null and p_status not in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'status'));
  end if;
  if p_priority is not null and p_priority not in ('NORMAL', 'HIGH', 'URGENT') then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'priority'));
  end if;
  if p_assign_to is not null then
    if not exists (select 1 from public.platform_memberships where user_id = p_assign_to and role in ('SUPPORT', 'SUPERADMIN') and status = 'ACTIVE') then
      perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'assign_to'));
    end if;
    if p_assign_to <> v_actor and not v_super then
      perform app.fail('FORBIDDEN', jsonb_build_object('reason', 'superadmin_only'));
    end if;
  end if;
  if p_status in ('RESOLVED', 'CLOSED') and coalesce(nullif(trim(p_resolution), ''), v_ticket.customer_visible_resolution) is null then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'customer_visible_resolution'));
  end if;
  if p_resolution is not null and char_length(trim(p_resolution)) not between 3 and 2000 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'customer_visible_resolution'));
  end if;
  if p_note is not null and char_length(trim(p_note)) not between 1 and 5000 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'note'));
  end if;
  update public.support_tickets set
    status = coalesce(p_status, status),
    priority = coalesce(p_priority, priority),
    assigned_admin_id = coalesce(p_assign_to, assigned_admin_id),
    customer_visible_resolution = coalesce(nullif(trim(p_resolution), ''), customer_visible_resolution),
    resolved_at = case when coalesce(p_status, status) in ('RESOLVED', 'CLOSED') then coalesce(resolved_at, now()) else null end
  where id = p_ticket_id returning * into v_ticket;
  if p_note is not null then
    insert into public.ticket_notes (ticket_id, author_id, body) values (p_ticket_id, v_actor, trim(p_note));
  end if;
  perform app.audit(v_actor, case when v_super then 'SUPERADMIN' else 'SUPPORT' end, 'ticket.update', 'support_ticket', p_ticket_id,
                    v_ticket.venue_id, p_request_id, null,
                    jsonb_strip_nulls(jsonb_build_object('status', p_status, 'priority', p_priority, 'assigned', p_assign_to is not null,
                                                         'resolution', p_resolution is not null, 'note', p_note is not null)));
  return app.ticket_json(v_ticket);
end;
$$;

-- Contact escalation: the reporter's verified email for this ticket, with a reason. Audited every time.
create or replace function app.admin_ticket_contact(p_ticket_id uuid, p_reason text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_platform_admin();
  v_ticket public.support_tickets;
  v_email text;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if not found or not app.can_see_ticket(v_ticket, v_actor) then
    perform app.fail('NOT_FOUND');
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 10 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  select lower(u.email) into v_email from public.profiles p join auth.users u on u.id = p.auth_user_id where p.id = v_ticket.reporter_id;
  perform app.audit(v_actor, case when app.has_platform_role(array['SUPERADMIN']) then 'SUPERADMIN' else 'SUPPORT' end,
                    'ticket.contact_reveal', 'support_ticket', p_ticket_id, v_ticket.venue_id, p_request_id, trim(p_reason));
  return jsonb_build_object('ticket_id', p_ticket_id, 'email', v_email);
end;
$$;

-- Admin booking lookup (A03a/A03) -------------------------------------------------------------------------------------
create or replace function app.require_booking_lookup()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return app.require_platform_admin(array['SUPPORT', 'FINANCE', 'SUPERADMIN']);
end;
$$;

create or replace function app.admin_booking_search(
  p_ref text, p_venue_id uuid, p_date date, p_email text, p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_booking_lookup();
  v_customer uuid;
begin
  if p_ref is null and p_venue_id is null and p_date is null and p_email is null then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'query'));
  end if;
  if p_email is not null then
    select p.id into v_customer from public.profiles p join auth.users u on u.id = p.auth_user_id where lower(u.email) = lower(trim(p_email));
    -- Searching by a person's email is a personal-data lookup: audited even when nothing matches.
    perform app.audit(v_actor, 'PLATFORM_ADMIN', 'booking.lookup_by_email', 'profile', v_customer, null, p_request_id, null,
                      jsonb_build_object('matched', v_customer is not null));
    if v_customer is null then
      return '[]'::jsonb;
    end if;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('booking_id', b.id, 'public_ref', b.public_ref, 'status', b.status, 'venue_name', v.name,
                                        'start_at', b.start_at, 'end_at', b.end_at, 'total_paise', b.total_paise) order by b.start_at desc)
    from (select * from public.bookings b
          where (p_ref is null or b.public_ref = upper(trim(p_ref)))
            and (p_venue_id is null or b.venue_id = p_venue_id)
            and (p_date is null or (b.start_at at time zone 'Asia/Kolkata')::date = p_date)
            and (v_customer is null or b.customer_id = v_customer)
          order by b.start_at desc limit 50) b
    join public.venues v on v.id = b.venue_id), '[]'::jsonb);
end;
$$;

create or replace function app.admin_booking_detail(p_booking_id uuid, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_booking_lookup();
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.audit(v_actor, 'PLATFORM_ADMIN', 'booking.view', 'booking', p_booking_id, v_booking.venue_id, p_request_id, null);
  return jsonb_build_object(
    'booking', jsonb_build_object('booking_id', v_booking.id, 'public_ref', v_booking.public_ref, 'status', v_booking.status,
                                  'start_at', v_booking.start_at, 'end_at', v_booking.end_at, 'party_size', v_booking.party_size,
                                  'total_paise', v_booking.total_paise, 'cancel_reason', v_booking.cancel_reason, 'version', v_booking.version,
                                  'venue_name', (select name from public.venues where id = v_booking.venue_id),
                                  'table_label', (select label from public.resources where id = v_booking.resource_id),
                                  'policy_version', (v_booking.policy_snapshot ->> 'policy_version')::integer),
    'events', coalesce((select jsonb_agg(jsonb_build_object('event_type', e.event_type, 'from_status', e.from_status, 'to_status', e.to_status,
                                                            'reason_code', e.reason_code, 'at', e.created_at) order by e.created_at)
                        from public.booking_events e where e.booking_id = p_booking_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('payment_order_id', o.id, 'order_state', o.state, 'extension_id', o.extension_id,
                                                              'expected_amount_paise', o.expected_amount_paise,
                                                              'attempts', coalesce((select jsonb_agg(jsonb_build_object(
                                                                  'attempt_id', a.id, 'state', a.state, 'amount_paise', a.amount_paise,
                                                                  'allocation_state', a.allocation_state, 'captured_at', a.captured_at) order by a.created_at)
                                                                from public.payment_attempts a where a.payment_order_id = o.id), '[]'::jsonb))
                                           order by o.attempt_no)
                          from public.payment_orders o where o.booking_id = p_booking_id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('refund_id', f.id, 'amount_paise', f.amount_paise, 'reason_code', f.reason_code,
                                                             'status', f.status, 'created_at', f.created_at) order by f.created_at)
                         from public.refunds f where f.booking_id = p_booking_id), '[]'::jsonb),
    'extensions', coalesce((select jsonb_agg(jsonb_build_object('status', x.status, 'additional_minutes', x.additional_minutes,
                                                                'amount_paise', x.amount_paise, 'created_at', x.created_at) order by x.created_at)
                            from public.extension_requests x where x.booking_id = p_booking_id), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('ticket_id', t.id, 'public_ref', t.public_ref, 'status', t.status,
                                                             'category', t.category) order by t.created_at)
                         from public.support_tickets t where t.booking_id = p_booking_id and app.can_see_ticket(t, v_actor)), '[]'::jsonb));
end;
$$;

-- Customer projection adds the customer's own review of this booking.
create or replace function app.customer_booking_json(p_booking public.bookings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'booking_id', p_booking.id,
    'public_ref', p_booking.public_ref,
    'status', p_booking.status,
    'hold_active', p_booking.status in ('HOLD', 'PENDING_PAYMENT') and p_booking.hold_expires_at > clock_timestamp(),
    'start_at', p_booking.start_at,
    'end_at', p_booking.end_at,
    'party_size', p_booking.party_size,
    'hold_expires_at', p_booking.hold_expires_at,
    'confirmed_at', p_booking.confirmed_at,
    'checked_in_at', p_booking.checked_in_at,
    'checked_out_at', p_booking.checked_out_at,
    'cancelled_at', p_booking.cancelled_at,
    'cancel_reason', p_booking.cancel_reason,
    'expired_at', p_booking.expired_at,
    'total_paise', p_booking.total_paise,
    'currency', p_booking.currency,
    'price_snapshot', p_booking.price_snapshot,
    'policy_snapshot', p_booking.policy_snapshot,
    'version', p_booking.version,
    'venue', (select jsonb_build_object('id', v.id, 'slug', v.slug, 'name', v.name, 'address', v.address,
                                        'locality', v.locality, 'timezone', v.timezone, 'is_synthetic', v.is_synthetic,
                                        'lat', round(extensions.st_y(v.location::extensions.geometry)::numeric, 4),
                                        'lng', round(extensions.st_x(v.location::extensions.geometry)::numeric, 4))
              from public.venues v where v.id = p_booking.venue_id),
    'table', (select jsonb_build_object('label', r.label, 'capacity', r.capacity)
              from public.resources r where r.id = p_booking.resource_id),
    'payment', app.booking_payment_summary(p_booking.id),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('refund_id', f.id, 'status', f.status, 'amount_paise', f.amount_paise,
                                                             'reason_code', f.reason_code, 'created_at', f.created_at)
                                          order by f.created_at)
                         from public.refunds f where f.booking_id = p_booking.id), '[]'::jsonb),
    'extension', (select app.extension_json(x) from public.extension_requests x where x.booking_id = p_booking.id
                  order by x.created_at desc limit 1),
    'extensions_applied', coalesce((select jsonb_agg(jsonb_build_object('extension_id', x.id, 'additional_minutes', x.additional_minutes,
                                                                        'amount_paise', x.amount_paise, 'applied_at', x.applied_at)
                                                     order by x.applied_at)
                                    from public.extension_requests x where x.booking_id = p_booking.id and x.status = 'APPLIED'), '[]'::jsonb),
    'review', (select app.review_json(r) from public.reviews r where r.booking_id = p_booking.id),
    'server_now', clock_timestamp());
$$;

grant execute on function
  app.create_review(uuid, integer, text, uuid),
  app.moderate_review(uuid, text, text, integer, uuid),
  app.admin_review_queue(text),
  app.create_ticket(uuid, text, text, uuid),
  app.staff_report_incident(uuid, uuid, text, text, boolean, uuid),
  app.my_tickets(),
  app.my_ticket(uuid),
  app.admin_ticket_queue(text),
  app.admin_ticket_detail(uuid),
  app.admin_update_ticket(uuid, text, text, uuid, text, text, integer, uuid),
  app.admin_ticket_contact(uuid, text, uuid),
  app.admin_booking_search(text, uuid, date, text, uuid),
  app.admin_booking_detail(uuid, uuid)
  to authenticated;
grant execute on function app.venue_reviews(uuid) to anon, authenticated;
-- Internal: new_ticket_ref, review_json, ticket_json, insert_ticket, can_see_ticket, require_booking_lookup.
revoke execute on all functions in schema app from public;
