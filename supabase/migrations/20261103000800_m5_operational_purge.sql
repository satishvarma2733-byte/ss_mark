-- M5.5 retention: operational caches are removed once they can no longer be used. Personal-data retention and erasure
-- rules await owner decision D09; this purge touches only:
--   * idempotency responses past their seven-day expiry (permanent payment/refund/payout uniqueness lives in each
--     table's own unique keys and is unaffected, docs/07 s.1);
--   * quotes that expired more than seven days ago and never became a booking (a booked quote is kept with it).
-- Runs from the worker in small batches; safe to repeat.
create or replace function app.purge_operational_data(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_idempotency integer;
  v_quotes integer;
begin
  delete from public.idempotency_records
   where id in (select id from public.idempotency_records where expires_at < now() order by expires_at limit v_limit);
  get diagnostics v_idempotency = row_count;
  delete from public.quotes q
   where q.id in (select x.id from public.quotes x
                  where x.expires_at < now() - interval '7 days'
                    and not exists (select 1 from public.bookings b where b.quote_id = x.id)
                  order by x.expires_at limit v_limit);
  get diagnostics v_quotes = row_count;
  return jsonb_build_object('idempotency_records', v_idempotency, 'quotes', v_quotes);
end;
$$;

grant execute on function app.purge_operational_data(integer) to simply_worker;
revoke execute on all functions in schema app from public;
