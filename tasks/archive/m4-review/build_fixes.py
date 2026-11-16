"""Builds supabase/migrations/20261103000600_m4_review_fixes.sql from the current function definitions.

Each redefined function is copied from the newest migration that defines it, then targeted replacements are applied
(every replacement must match exactly once, so a drift in the source fails loudly instead of silently).
"""
import os
import re

ROOT = r"c:\Users\abhin\Desktop\Simply_Sit\build-kit"
MIG = os.path.join(ROOT, "supabase", "migrations")


def latest_definition(name):
    found = None
    for fname in sorted(os.listdir(MIG)):
        if fname >= "20261103000600":
            continue
        text = open(os.path.join(MIG, fname), encoding="utf-8").read().replace("\r\n", "\n")
        for m in re.finditer(r"create or replace function app\." + re.escape(name) + r"\(", text):
            end = text.index("\n$$;\n", text.index("as $$", m.start())) + len("\n$$;\n")
            found = (fname, text[m.start():end])
    assert found, name
    return found[1]


def patched(name, pairs):
    body = latest_definition(name)
    for old, new in pairs:
        assert body.count(old) == 1, (name, old[:90], body.count(old))
        body = body.replace(old, new)
    return body


parts = []
parts.append("""-- M4 review fixes (review of the M4 migrations, 3 Nov 2026). Each change is described where it applies.
""")

# F1 - cancellation / service cancellation / no-show refunds are capped by what the booking still holds, so an earlier
# admin refund taken from the booking can never make the refund exceed what is owed (or block the cancellation).
parts.append("""
-- F1: refunds that follow the policy are capped by the booking's remaining customer liability (an admin refund taken
-- from the booking before it finished has already paid part of it back).""")
parts.append(patched("cancellation_terms", [
    ("  v_refund bigint;\nbegin",
     "  v_refund bigint;\n"
     "  -- What this capture still holds for the booking (never more than the capture itself).\n"
     "  v_remaining bigint := least(p_captured_paise, greatest(app.booking_liability_balance(p_booking.id), 0));\nbegin"),
    ("  v_refund := app.div_half_up(p_captured_paise * v_bps, 10000);",
     "  v_refund := least(app.div_half_up(p_captured_paise * v_bps, 10000), v_remaining);"),
    ("    'retained_paise', p_captured_paise - v_refund,",
     "    'retained_paise', v_remaining - v_refund,"),
]))

parts.append(patched("staff_mark_no_show", [
    ("  v_amount := app.div_half_up(v_attempt.amount_paise * coalesce((v_booking.policy_snapshot ->> 'no_show_refund_bps')::integer, 0), 10000);",
     "  v_amount := least(app.div_half_up(v_attempt.amount_paise * coalesce((v_booking.policy_snapshot ->> 'no_show_refund_bps')::integer, 0), 10000),\n"
     "                   greatest(app.booking_liability_balance(p_booking_id), 0));"),
]))

# F5 - a venue's terms are frozen while the venue is in review.
parts.append("""
-- F5: while a venue is in review, its draft terms cannot change (or be created): the reviewer approves exactly what
-- was submitted. Status changes made by the review itself are allowed.
create or replace function app.guard_policy_in_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'DRAFT'
     and exists (select 1 from public.venues v where v.id = new.venue_id and v.status = 'PENDING_REVIEW')
     and (tg_op = 'INSERT' or (
       (new.byo_food, new.byo_details, new.outside_delivery, new.handover_instructions, new.house_rules, new.cancel_cutoff_minutes,
        new.early_refund_bps, new.late_refund_bps, new.no_show_refund_bps, new.minimum_minutes, new.increment_minutes,
        new.maximum_minutes, new.buffer_minutes, new.grace_minutes, new.lead_minutes, new.max_horizon_days, new.end_reminder_minutes)
       is distinct from
       (old.byo_food, old.byo_details, old.outside_delivery, old.handover_instructions, old.house_rules, old.cancel_cutoff_minutes,
        old.early_refund_bps, old.late_refund_bps, old.no_show_refund_bps, old.minimum_minutes, old.increment_minutes,
        old.maximum_minutes, old.buffer_minutes, old.grace_minutes, old.lead_minutes, old.max_horizon_days, old.end_reminder_minutes))) then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('reason', 'venue_in_review'));
  end if;
  return new;
end;
$$;
create trigger venue_policies_in_review before insert or update on public.venue_policies
  for each row execute function app.guard_policy_in_review();
""")

# F8 - only owners revoke a MANAGER invitation (same rule as inviting or removing a manager).
parts.append(patched("partner_revoke_invitation", [
    ("  v_actor := app.require_venue_manager(v_invitation.venue_id);\n",
     "  v_actor := app.require_venue_manager(v_invitation.venue_id);\n"
     "  if v_invitation.role = 'MANAGER' and not app.is_venue_member(v_invitation.venue_id, array['OWNER']) then\n"
     "    perform app.fail('FORBIDDEN', jsonb_build_object('reason', 'owner_only'));\n"
     "  end if;\n"),
]))

# F9 - an expired invitation is refused without a (rolled-back) write; stale invitations are expired venue-wide before
# the open-invitation limit is counted.
parts.append(patched("accept_invitation", [
    ("    update public.venue_invitations set status = 'EXPIRED' where id = p_invitation_id and status = 'INVITED';\n", ""),
]))
parts.append(patched("partner_invite", [
    ("  where venue_id = p_venue_id and email = v_email and status = 'INVITED' and expires_at <= now();",
     "  where venue_id = p_venue_id and status = 'INVITED' and expires_at <= now();"),
]))

# F2 - failed refunds: the liability stays owed and is retried, never re-created.
parts.append("""
-- F2: a FAILED refund is still owed (its liability stays posted). Finance retries it as a new provider operation linked
-- by retry_of, with no new journal and no new charge to the partner or platform. Until retried, a FAILED refund still
-- counts against what admin refunds may add, so it can never be paid (or charged) twice.
alter table public.refunds add column retry_of uuid references public.refunds (id);
create unique index refunds_one_retry on public.refunds (retry_of) where retry_of is not null;
alter table public.refunds drop constraint refunds_admin_fields;
alter table public.refunds add constraint refunds_admin_fields check (
  (reason_code = 'ADMIN_REFUND' and retry_of is null) = (charge_to is not null and admin_reason is not null and requested_by is not null));
comment on column public.refunds.retry_of is 'The FAILED refund this one retries. Retries carry no journal and no charge_to.';

create or replace function app.guard_refund_admin_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.reason_code, new.charge_to, new.admin_reason, new.requested_by, new.retry_of)
     is distinct from (old.reason_code, old.charge_to, old.admin_reason, old.requested_by, old.retry_of) then
    perform app.fail('IMMUTABLE_RECORD', jsonb_build_object('table', 'refunds', 'reason', 'admin_fields'));
  end if;
  return new;
end;
$$;

-- Money a payment attempt has committed to refunds: everything except FAILED refunds that a retry has taken over.
create or replace function app.refund_reserved(p_attempt_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(f.amount_paise), 0)::bigint from public.refunds f
  where f.payment_attempt_id = p_attempt_id
    and not (f.status = 'FAILED' and exists (select 1 from public.refunds r where r.retry_of = f.id));
$$;
""")

parts.append(patched("refundable_attempts", [
    ("  cross join lateral (select coalesce(sum(f.amount_paise), 0)::bigint as reserved from public.refunds f\n"
     "                      where f.payment_attempt_id = a.id and f.status <> 'FAILED') r",
     "  cross join lateral (select app.refund_reserved(a.id) as reserved) r"),
]))

# F2 + F6 + F7 in admin_refund.
parts.append(patched("admin_refund", [
    ("  v_now := app.lock_booking(p_booking_id);\n",
     "  v_now := app.lock_booking(p_booking_id);\n"
     "  -- F6: a replayed request returns the refund it already created.\n"
     "  if p_request_id is not null then\n"
     "    select * into v_refund from public.refunds where operation_key = 'refund:admin:' || p_request_id;\n"
     "    if found then\n"
     "      return jsonb_build_object('refund_id', v_refund.id, 'booking_id', v_refund.booking_id, 'status', v_refund.status,\n"
     "                                'amount_paise', v_refund.amount_paise, 'charge_to', v_refund.charge_to, 'replayed', true);\n"
     "    end if;\n"
     "  end if;\n"),
    ("   order by a.amount_paise - (select coalesce(sum(f.amount_paise), 0) from public.refunds f\n"
     "                               where f.payment_attempt_id = a.id and f.status <> 'FAILED') desc, a.created_at",
     "   order by a.amount_paise - app.refund_reserved(a.id) desc, a.created_at"),
    ("  v_refundable := v_attempt.amount_paise - (select coalesce(sum(f.amount_paise), 0) from public.refunds f\n"
     "                                             where f.payment_attempt_id = v_attempt.id and f.status <> 'FAILED');",
     "  v_refundable := v_attempt.amount_paise - app.refund_reserved(v_attempt.id);"),
    # F7: a single finance person requests the refund; nobody else approved it, so approved_by stays empty.
    ("  values (v_attempt.id, p_booking_id, p_amount_paise, 'INR', 'ADMIN_REFUND',\n"
     "          'refund:admin:' || coalesce(p_request_id, gen_random_uuid()), v_actor, v_actor, v_charge, v_reason)",
     "  values (v_attempt.id, p_booking_id, p_amount_paise, 'INR', 'ADMIN_REFUND',\n"
     "          'refund:admin:' || coalesce(p_request_id, gen_random_uuid()), v_actor, null, v_charge, v_reason)"),
]))

parts.append("""
create or replace function app.admin_retry_refund(p_refund_id uuid, p_reason text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_finance();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_booking_id uuid;
  v_failed public.refunds;
  v_retry public.refunds;
begin
  if char_length(v_reason) not between 10 and 500 then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason'));
  end if;
  select booking_id into v_booking_id from public.refunds where id = p_refund_id;
  if v_booking_id is null then
    perform app.fail('NOT_FOUND');
  end if;
  perform app.lock_booking(v_booking_id);
  select * into v_failed from public.refunds where id = p_refund_id for update;
  if v_failed.status <> 'FAILED' then
    perform app.fail('INVALID_TRANSITION', jsonb_build_object('status', v_failed.status));
  end if;
  select * into v_retry from public.refunds where retry_of = p_refund_id;
  if found then
    return jsonb_build_object('refund_id', v_retry.id, 'retry_of', p_refund_id, 'status', v_retry.status,
                              'amount_paise', v_retry.amount_paise, 'replayed', true);
  end if;
  insert into public.refunds (payment_attempt_id, booking_id, amount_paise, currency, reason_code, operation_key, requested_by, retry_of)
  values (v_failed.payment_attempt_id, v_failed.booking_id, v_failed.amount_paise, v_failed.currency, v_failed.reason_code,
          'refund:retry:' || v_failed.id, v_actor, v_failed.id)
  returning * into v_retry;
  perform app.enqueue_job('refund:' || v_retry.id || ':submit', 'refund.submit', jsonb_build_object('refund_id', v_retry.id));
  insert into public.booking_events (booking_id, actor_id, event_type, reason_code, request_id, business_key, safe_metadata)
  values (v_failed.booking_id, v_actor, 'REFUND_RETRIED', v_failed.reason_code, p_request_id, 'refund:' || v_retry.id || ':retry',
          jsonb_build_object('refund_id', v_retry.id, 'retry_of', v_failed.id, 'amount_paise', v_retry.amount_paise));
  perform app.audit(v_actor, app.finance_role(), 'refund.retried', 'refund', v_retry.id,
                    (select venue_id from public.bookings where id = v_failed.booking_id), p_request_id, v_reason,
                    jsonb_build_object('retry_of', v_failed.id, 'amount_paise', v_retry.amount_paise));
  return jsonb_build_object('refund_id', v_retry.id, 'retry_of', p_refund_id, 'status', v_retry.status,
                            'amount_paise', v_retry.amount_paise, 'replayed', false);
end;
$$;
""")

# Finance sees which failed refunds on the booking still need a retry.
parts.append(patched("admin_refund_options", [
    ("    'needs_charge_to', v_earnable,\n",
     "    'needs_charge_to', v_earnable,\n"
     "    'retryable', coalesce((select jsonb_agg(jsonb_build_object('refund_id', f.id, 'amount_paise', f.amount_paise,\n"
     "                                                               'reason_code', f.reason_code, 'last_error_code', f.last_error_code,\n"
     "                                                               'created_at', f.created_at) order by f.created_at)\n"
     "                           from public.refunds f\n"
     "                           where f.booking_id = p_booking_id and f.status = 'FAILED'\n"
     "                             and not exists (select 1 from public.refunds r where r.retry_of = f.id)), '[]'::jsonb),\n"),
]))

# The refunds-needing-attention list leaves out failed refunds that are already being retried.
parts.append(patched("admin_finance_overview", [
    ("              where status in ('FAILED', 'UNKNOWN')\n",
     "              where (status = 'UNKNOWN'\n"
     "                     or (status = 'FAILED' and not exists (select 1 from public.refunds r where r.retry_of = refunds.id)))\n"),
]))

# F3 + F4 - payout approval: every capture (and processed refund) behind the batch must be covered by a MATCHED run of
# the same provider and environment that is newer than any MISMATCH run covering it. Several runs may cover a batch,
# so a batch longer than one 31-day run can be approved.
parts.append(patched("approve_payout_batch", [
    ("  v_run public.reconciliation_runs;\n  v_available bigint;\n",
     "  v_run public.reconciliation_runs;\n  v_available bigint;\n  v_uncovered integer;\n  v_first timestamptz;\n  v_blocking uuid;\n"),
    ("  -- The latest completed run touching the batch period decides: it must be MATCHED and cover the whole period.\n"
     "  select * into v_run from public.reconciliation_runs\n"
     "   where status in ('MATCHED', 'MISMATCH') and period_from <= v_batch.period_end and period_to >= v_batch.period_start\n"
     "   order by completed_at desc limit 1;\n"
     "  if v_run.id is null or v_run.status <> 'MATCHED' or v_run.period_from > v_batch.period_start\n"
     "     or v_run.period_to <= v_batch.period_end then\n"
     "    perform app.fail('RECONCILIATION_REQUIRED', jsonb_build_object(\n"
     "      'latest_run_id', v_run.id, 'latest_status', v_run.status,\n"
     "      'needed_from', v_batch.period_start, 'needed_to', v_batch.period_end));\n"
     "  end if;\n",
     "  -- Every capture behind the batch, and every processed refund of its bookings or adjustments, must sit inside a\n"
     "  -- MATCHED run of its own provider and environment with no newer MISMATCH run over the same instant.\n"
     "  create temporary table payout_points on commit drop as\n"
     "  select a.captured_at as at, a.provider, a.environment\n"
     "  from public.payout_allocations x\n"
     "  join public.payment_attempts a on a.booking_id = x.booking_id and a.state = 'CAPTURED'\n"
     "                                and a.allocation_state in ('BOOKING', 'EXTENSION')\n"
     "  where x.batch_id = p_batch_id\n"
     "  union\n"
     "  select f.processed_at, a.provider, a.environment\n"
     "  from public.payout_allocations x\n"
     "  join public.refunds f on f.booking_id = x.booking_id and f.status = 'PROCESSED'\n"
     "  join public.payment_attempts a on a.id = f.payment_attempt_id\n"
     "  where x.batch_id = p_batch_id;\n"
     "  select count(*), min(p.at) into v_uncovered, v_first\n"
     "  from pg_temp.payout_points p\n"
     "  where not exists (\n"
     "    select 1 from public.reconciliation_runs r\n"
     "    where r.status = 'MATCHED' and r.provider = p.provider and r.environment = p.environment\n"
     "      and r.period_from <= p.at and r.period_to > p.at\n"
     "      and not exists (select 1 from public.reconciliation_runs m\n"
     "                      where m.status = 'MISMATCH' and m.provider = p.provider and m.environment = p.environment\n"
     "                        and m.period_from <= p.at and m.period_to > p.at and m.completed_at > r.completed_at));\n"
     "  if v_uncovered > 0 then\n"
     "    select m.id into v_blocking from public.reconciliation_runs m\n"
     "     where m.status = 'MISMATCH' and m.period_from <= v_first and m.period_to > v_first\n"
     "     order by m.completed_at desc limit 1;\n"
     "    drop table pg_temp.payout_points;\n"
     "    perform app.fail('RECONCILIATION_REQUIRED', jsonb_build_object(\n"
     "      'uncovered', v_uncovered, 'first_uncovered_at', v_first, 'mismatch_run_id', v_blocking));\n"
     "  end if;\n"
     "  -- The newest matched run covering the batch is recorded on it.\n"
     "  select r.* into v_run from public.reconciliation_runs r\n"
     "   where r.status = 'MATCHED' and exists (select 1 from pg_temp.payout_points p\n"
     "                                         where r.provider = p.provider and r.environment = p.environment\n"
     "                                           and r.period_from <= p.at and r.period_to > p.at)\n"
     "   order by r.completed_at desc limit 1;\n"
     "  drop table pg_temp.payout_points;\n"),
]))

# F4 (metrics) - the reconciliation state only counts runs of the environment the period's captures came from.
parts.append(patched("admin_business_metrics", [
    ("    select * into v_run from public.reconciliation_runs\n"
     "     where status in ('MATCHED', 'MISMATCH') and period_from <= v_end and period_to >= v_start\n"
     "     order by completed_at desc limit 1;",
     "    select * into v_run from public.reconciliation_runs\n"
     "     where status in ('MATCHED', 'MISMATCH') and period_from <= v_end and period_to >= v_start\n"
     "       and environment = coalesce((select a.environment from public.payment_attempts a\n"
     "                                   where a.state = 'CAPTURED' and a.captured_at >= v_start and a.captured_at < v_end\n"
     "                                   group by a.environment order by count(*) desc limit 1), environment)\n"
     "     order by completed_at desc limit 1;"),
]))

parts.append("""
grant execute on function app.admin_retry_refund(uuid, text, uuid) to authenticated;
-- Internal: refund_reserved, guard_policy_in_review.
revoke execute on all functions in schema app from public;
""")

out = os.path.join(MIG, "20261103000600_m4_review_fixes.sql")
with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(p.rstrip("\n") + "\n" for p in parts))
print("wrote", out)
