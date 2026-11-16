-- M2 durable work, idempotency, notifications, privacy requests and audit (docs/05 "Money, durable work and support").

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  actor_scope text not null,
  route text not null,
  key uuid not null,
  request_hash text not null,
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'COMPLETE')),
  safe_response jsonb,
  http_status integer,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (actor_scope, route, key)
);
create index idempotency_records_expiry_idx on public.idempotency_records (expires_at);
create trigger idempotency_records_touch before update on public.idempotency_records for each row execute function app.touch_row();

create table public.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  business_key text not null unique,
  kind text not null check (kind in (
    'booking.hold_expired', 'notification.email', 'privacy.delete_requested', 'diagnostic.sleep'
  )),
  safe_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_payload) = 'object' and pg_column_size(safe_payload) < 4096),
  status text not null default 'READY' check (status in ('READY', 'LEASED', 'DONE', 'DEAD')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 50),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  leased_by text,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint outbox_jobs_lease check (status <> 'LEASED' or (lease_until is not null and leased_by is not null))
);
comment on table public.outbox_jobs is 'At-least-once work queue. Handlers must be idempotent; expired leases recover crashed workers.';
create index outbox_jobs_due_idx on public.outbox_jobs (status, available_at);
create index outbox_jobs_lease_idx on public.outbox_jobs (status, lease_until);
create trigger outbox_jobs_touch before update on public.outbox_jobs for each row execute function app.touch_row();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  booking_id uuid references public.bookings (id),
  event_key text not null,
  channel text not null check (channel in ('IN_APP', 'EMAIL')),
  template text not null check (char_length(template) between 1 and 60),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SENT', 'FAILED')),
  provider_ref text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (event_key, user_id, channel)
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create trigger notifications_touch before update on public.notifications for each row execute function app.touch_row();

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('EXPORT', 'DELETE')),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'PROCESSING', 'NEEDS_REVIEW', 'FULFILLED', 'REJECTED')),
  verified_at timestamptz not null,
  fulfillment_due_at timestamptz,
  safe_reason text check (safe_reason is null or char_length(safe_reason) <= 500),
  export_storage_key text,
  export_expires_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index privacy_requests_user_idx on public.privacy_requests (user_id, created_at);
create index privacy_requests_due_idx on public.privacy_requests (status, fulfillment_due_at);
-- One open request per user and kind; repeated submissions return the existing request.
create unique index privacy_requests_one_open on public.privacy_requests (user_id, kind)
  where status in ('REQUESTED', 'PROCESSING', 'NEEDS_REVIEW');
create trigger privacy_requests_touch before update on public.privacy_requests for each row execute function app.touch_row();

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id),
  actor_role text not null,
  action text not null check (char_length(action) between 1 and 80),
  entity_type text not null,
  entity_id uuid,
  venue_id uuid references public.venues (id),
  request_id uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  safe_diff jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_diff) = 'object' and pg_column_size(safe_diff) < 8192),
  created_at timestamptz not null default now()
);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at);
create index audit_events_actor_idx on public.audit_events (actor_id, created_at);
create index audit_events_venue_idx on public.audit_events (venue_id, created_at);
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function app.forbid_change();

create table public.worker_heartbeats (
  worker_id text primary key check (char_length(worker_id) between 1 and 100),
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  ticks bigint not null default 0,
  jobs_completed bigint not null default 0,
  jobs_failed bigint not null default 0,
  holds_expired bigint not null default 0,
  last_error_code text
);

-- Development-only effect log used to prove that an at-least-once handler applies its effect exactly once.
create table public.diagnostic_effects (
  business_key text primary key,
  worker_id text not null,
  applied_at timestamptz not null default now()
);
