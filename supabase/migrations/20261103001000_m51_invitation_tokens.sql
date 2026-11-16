-- M5.1 review F1 (tasks/current/M5.1-FINDINGS.md): accepting a venue invitation needs the link from the invitation
-- email, not only a matching confirmed Auth email. A confirmed email is not proof of mailbox ownership whenever Auth
-- confirms addresses without a message (auto-confirm sign-up or email change), so the email carries an unguessable
-- token: HMAC-SHA256 of the invitation ID with the server secret (packages/domain invitation.ts). The database keeps
-- only its SHA-256 hash, written by the worker before the email is sent. Until then the invitation cannot be accepted.

alter table public.venue_invitations
  add column token_hash text check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$');
comment on column public.venue_invitations.token_hash is 'SHA-256 of the emailed accept-link token. Never granted to clients.';

-- Open invitations from before this change were emailed without a link and could never be accepted: managers send
-- them again (fictional local data only before release).
update public.venue_invitations set status = 'EXPIRED' where status = 'INVITED' and token_hash is null;

-- Worker: the hash of the link token, recorded before the invitation email is sent. The token is deterministic, so a
-- retried delivery writes the same hash; a rotated secret replaces it (the old link stops working).
create or replace function app.record_invitation_token(p_invitation_id uuid, p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_worker() then
    perform app.fail('FORBIDDEN');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    perform app.fail('VALIDATION_FAILED', jsonb_build_object('field', 'token_hash'));
  end if;
  update public.venue_invitations set token_hash = p_token_hash
   where id = p_invitation_id and status = 'INVITED' and token_hash is distinct from p_token_hash;
  return exists (select 1 from public.venue_invitations where id = p_invitation_id and status = 'INVITED' and token_hash = p_token_hash);
end;
$$;

-- POST /invitations/{id}/accept {token}: the signed-in user's confirmed email AND the emailed token must both match.
-- A wrong token, another account or a missing token all read as NOT_FOUND. Never downgrades an existing role.
drop function app.accept_invitation(uuid, uuid);
create or replace function app.accept_invitation(p_invitation_id uuid, p_token text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.require_active_profile();
  v_invitation public.venue_invitations;
  v_existing public.venue_memberships;
  v_role text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform app.fail('NOT_FOUND');
  end if;
  select * into v_invitation from public.venue_invitations
  where id = p_invitation_id and email = app.my_auth_email() and token_hash = app.sha256_hex(p_token) for update;
  if not found or v_invitation.status in ('REVOKED') then
    perform app.fail('NOT_FOUND');
  end if;
  if v_invitation.status = 'ACCEPTED' and v_invitation.accepted_by = v_actor then
    return jsonb_build_object('venue_id', v_invitation.venue_id, 'status', 'ACCEPTED', 'replayed', true);
  end if;
  if v_invitation.status <> 'INVITED' or v_invitation.expires_at <= now() then
    perform app.fail('INVITATION_EXPIRED');
  end if;
  select * into v_existing from public.venue_memberships where venue_id = v_invitation.venue_id and user_id = v_actor for update;
  v_role := case
    when v_existing.status = 'ACTIVE' and v_existing.role = 'OWNER' then 'OWNER'
    when v_existing.status = 'ACTIVE' and v_existing.role = 'MANAGER' then 'MANAGER'
    else v_invitation.role end;
  insert into public.venue_memberships (venue_id, user_id, role, status, invited_by, accepted_at)
  values (v_invitation.venue_id, v_actor, v_role, 'ACTIVE', v_invitation.invited_by, now())
  on conflict (venue_id, user_id) do update set role = excluded.role, status = 'ACTIVE', accepted_at = now();
  update public.venue_invitations set status = 'ACCEPTED', accepted_by = v_actor, accepted_at = now() where id = p_invitation_id;
  perform app.audit(v_actor, 'INVITEE', 'invitation.accept', 'venue_invitation', p_invitation_id, v_invitation.venue_id,
                    p_request_id, null, jsonb_build_object('role', v_role));
  return jsonb_build_object('venue_id', v_invitation.venue_id, 'role', v_role, 'status', 'ACCEPTED', 'replayed', false);
end;
$$;

grant execute on function app.accept_invitation(uuid, text, uuid) to authenticated;
grant execute on function app.record_invitation_token(uuid, text) to simply_worker;
revoke execute on all functions in schema app from public;
