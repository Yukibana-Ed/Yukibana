-- Invite links that make a teacher of everyone who uses them, until an admin removes them.
--
-- An invite used to work once, for one person: accepting it deleted it. An admin who wanted ten colleagues as teachers sent ten links. Now one
-- link serves all of them: whoever accepts it ends up with at least teacher rights, and the link keeps working until an admin removes it. The
-- secret, its hash and who may create, list or remove an invite are unchanged (20261112090000_teacher_invites.sql).
--
-- What this costs: a link that is forwarded makes a teacher of whoever it is forwarded to. The admin sees how often each link was used, the
-- audit log says who used it, and removing a link stops it at once; it does not undo the teachers it made, which an admin demotes by address.
--
-- Invites created before this migration, each sent to one person, become reusable too. They were single-use only because accepting deleted
-- them, and the people they were sent to may not have opened them yet, so they are kept rather than deleted.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- How many accounts this invite has made teachers. An account that already had teacher rights and accepts it is not counted, because the
-- invite changed nothing for it. Admins read it to see a link spreading further than they meant.
alter table public.teacher_invite add column uses bigint not null default 0 check (uses >= 0);
grant select (uses) on public.teacher_invite to authenticated;

-- Removes the invite `invite`, so that its link stops working. Teachers it already made stay teachers. Any admin may remove any admin's invite.
--
-- Requires: the caller is an admin, else 42501; the invite exists, else P0002.
create or replace function app.revoke_teacher_invite(invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed public.teacher_invite%rowtype;
begin
  if not app.is_admin() then
    raise exception 'Only an admin can remove an invite.' using errcode = '42501';
  end if;
  delete from public.teacher_invite t where t.invite_id = invite returning * into removed;
  if not found then
    raise exception 'This invite was already removed.' using errcode = 'P0002';
  end if;
  perform app.audit('revoke_teacher_invite', jsonb_build_object('invite_id', invite, 'label', removed.label, 'uses', removed.uses));
end
$$;

-- Gives the caller at least teacher rights through the invite whose secret has the sha256 `secret_hash`, and keeps the invite for the next
-- person.
--
-- - A caller whose platform role is `user` becomes a teacher; the invite's `uses` goes up by one, and it is audited.
-- - A teacher or an admin already has what the invite gives: nothing changes and nothing is audited, and an admin is never demoted.
--
-- Requires: an invite has that hash, else P0002, whoever the caller is, so that a dead link says so to everyone; the caller has an account,
-- else 42501.
--
-- The `update` of the invite takes its row lock, so an admin removing it at the same moment either waits for this to commit (and the
-- teacher was made with a live invite) or commits first, and this finds no row and refuses.
create or replace function app.redeem_teacher_invite(secret_hash bytea)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role app.platform_role := app.platform_role();
  invite public.teacher_invite%rowtype;
begin
  if caller_role is null then
    raise exception 'Only a signed-in account can accept an invite.' using errcode = '42501';
  end if;
  if caller_role <> 'user' then
    if not exists (select 1 from public.teacher_invite t where t.secret_hash = redeem_teacher_invite.secret_hash) then
      raise exception 'This invite was removed. Ask an admin for a new one.' using errcode = 'P0002';
    end if;
    return;
  end if;
  update public.teacher_invite t set uses = t.uses + 1 where t.secret_hash = redeem_teacher_invite.secret_hash returning * into invite;
  if not found then
    raise exception 'This invite was removed. Ask an admin for a new one.' using errcode = 'P0002';
  end if;
  update public.app_user set role = 'teacher' where user_id = (select auth.uid());
  perform app.audit('redeem_teacher_invite', jsonb_build_object('invite_id', invite.invite_id, 'label', invite.label, 'invited_by', invite.created_by));
end
$$;
