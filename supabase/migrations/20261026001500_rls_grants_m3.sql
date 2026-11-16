-- M3 authorization: read policies for money tables, function grants, PUBLIC revoke (docs/05 RLS matrix).
-- No client receives a write privilege. Payment truth is written only through worker-role functions.

-- Bookings: the owner may read confirmed_at; checkin_pin_hash (like checkin_token_hash) is never granted.
grant select (confirmed_at) on public.bookings to authenticated;

-- Finance readers: FINANCE or SUPERADMIN with a TOTP-verified session.
create or replace function app.is_finance_reader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_aal() = 'aal2' and app.has_platform_role(array['FINANCE', 'SUPERADMIN']);
$$;
grant execute on function app.is_finance_reader() to authenticated;

grant select (id, booking_id, venue_id, customer_id, provider, environment, provider_order_id, expected_amount_paise,
              currency, state, expires_at, created_at, updated_at, version)
  on public.payment_orders to authenticated;
create policy payment_orders_read on public.payment_orders for select to authenticated using (
  customer_id = (select app.my_profile_id()) or (select app.is_finance_reader())
);

grant select (id, payment_order_id, booking_id, provider, environment, provider_payment_id, amount_paise, currency, state,
              captured_at, allocation_state, created_at, updated_at, version)
  on public.payment_attempts to authenticated;
create policy payment_attempts_read on public.payment_attempts for select to authenticated using (
  booking_id in (select b.id from public.bookings b where b.customer_id = (select app.my_profile_id()))
  or (select app.is_finance_reader())
);

grant select (id, payment_attempt_id, booking_id, amount_paise, currency, reason_code, status, processed_at, created_at,
              updated_at, version)
  on public.refunds to authenticated;
create policy refunds_read on public.refunds for select to authenticated using (
  booking_id in (select b.id from public.bookings b where b.customer_id = (select app.my_profile_id()))
  or (select app.is_finance_reader())
);

grant select on public.payment_attempt_events, public.provider_events, public.ledger_accounts, public.ledger_journals,
                public.ledger_entries
  to authenticated;
create policy payment_attempt_events_read on public.payment_attempt_events for select to authenticated
  using ((select app.is_finance_reader()));
create policy provider_events_read on public.provider_events for select to authenticated
  using ((select app.is_finance_reader()));
create policy ledger_accounts_read on public.ledger_accounts for select to authenticated
  using ((select app.is_finance_reader()));
create policy ledger_journals_read on public.ledger_journals for select to authenticated
  using ((select app.is_finance_reader()));
create policy ledger_entries_read on public.ledger_entries for select to authenticated
  using ((select app.is_finance_reader()));

grant select on public.arrival_attempts to authenticated;
create policy arrival_attempts_read on public.arrival_attempts for select to authenticated using (
  venue_id = any ((select app.my_venue_ids(array['MANAGER', 'OWNER']))::uuid[])
  or (select app.has_platform_role(array['SUPERADMIN']))
);

-- Function grants ---------------------------------------------------------------------------------------------------
grant execute on function
  app.search_venues(double precision, double precision, integer, timestamptz, integer, integer, text[], text[], text[],
                    text[], boolean, integer, integer),
  app.venue_detail(uuid),
  app.venue_day_availability(uuid, date, integer, integer)
  to anon, authenticated;

grant execute on function
  app.begin_checkout(uuid, integer, text, text, uuid),
  app.customer_booking(uuid),
  app.customer_bookings(text, integer, integer),
  app.customer_payment_order(uuid),
  app.staff_arrivals(uuid, date),
  app.venue_bookings_calendar(uuid, timestamptz, timestamptz),
  app.staff_check_in(uuid, text, text, text, uuid),
  app.staff_check_out(uuid, integer, uuid),
  app.staff_mark_ready(uuid, integer, uuid)
  to authenticated;

grant execute on function
  app.claim_order_creation(uuid, integer),
  app.record_provider_order(uuid, text),
  app.record_order_creation_unknown(uuid, text),
  app.process_payment_observation(uuid, text, text, text, text, bigint, text, text, timestamptz, text, uuid, text, text),
  app.find_payment_order(text, text, text),
  app.get_payment_order(uuid),
  app.ingest_provider_event(text, text, text, text, jsonb, text),
  app.get_provider_event(uuid),
  app.mark_provider_event(uuid, text, text),
  app.orders_to_reconcile(integer),
  app.mark_order_reconciled(uuid),
  app.refund_for_submission(uuid),
  app.record_refund_result(uuid, text, text, text),
  app.job_notify_booking(uuid, text, text),
  app.booking_for_order(uuid)
  to simply_worker;

-- app.apply_payment_observation, app.post_journal, app.lock_booking and app.expire_resource_holds are internal:
-- reachable only from the SECURITY DEFINER functions above. Keep every app.* function closed to PUBLIC.
revoke execute on all functions in schema app from public;
