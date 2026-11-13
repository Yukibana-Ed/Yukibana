-- Invite links that make a teacher.
--
-- An admin creates a link and sends it to one person. That person opens it, signs in (which creates an account if they have none) and
-- accepts it, and becomes a teacher. Each link works once. Before this, an admin could only promote an account that already existed.
--
-- Like a project token, the link carries a secret that is shown once and never stored: the table keeps its sha256, and the Worker hashes the
-- secret it receives. Accepting or removing an invite deletes its row, so the table holds exactly the unused invites, and `audit_log` records
-- who created, removed or accepted each one.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table public.teacher_invite (
  invite_id   uuid primary key default app.uuidv7(),
  -- The sha256 of the secret in the link.
  secret_hash bytea not null unique check (octet_length(secret_hash) = 32),
  -- Whom the admin meant the invite for, in their words, so that the list tells invites apart; '' when they wrote nothing.
  label       text not null default '' check (length(label) <= 200),
  -- The admin who created it. An invite acts with that admin's authority, so it is deleted with their account.
  created_by  uuid not null references public.app_user (user_id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.teacher_invite enable row level security;
revoke all on public.teacher_invite from public, anon, authenticated;

-- Admins read every invite except its hash, which is the one value that could be matched against a link. The functions below do all writes.
create policy teacher_invite_read on public.teacher_invite for select to authenticated using (app.is_admin());
grant select (invite_id, label, created_by, created_at) on public.teacher_invite to authenticated;

-- Creates an invite labelled `label` (trimmed) and returns its secret: `yk_invite_` followed by 64 hexadecimal digits (256 random bits).
-- The secret is returned this once and stored nowhere.
--
-- Requires: the caller is an admin; otherwise raises 42501.
create or replace function app.create_teacher_invite(label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text := 'yk_invite_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  id uuid;
begin
  if not app.is_admin() then
    raise exception 'Only an admin can invite a teacher.' using errcode = '42501';
  end if;
  insert into public.teacher_invite (secret_hash, label, created_by)
  values (sha256(convert_to(secret, 'UTF8')), btrim(label), (select auth.uid()))
  returning invite_id into id;
  perform app.audit('create_teacher_invite', jsonb_build_object('invite_id', id, 'label', btrim(label)));
  return secret;
end
$$;

-- Deletes the unused invite `invite`, so that its link stops working. Any admin may remove any admin's invite.
--
-- Requires: the caller is an admin, else 42501; `invite` is unused, else P0002.
create or replace function app.revoke_teacher_invite(invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_label text;
begin
  if not app.is_admin() then
    raise exception 'Only an admin can remove an invite.' using errcode = '42501';
  end if;
  delete from public.teacher_invite t where t.invite_id = invite returning t.label into removed_label;
  if not found then
    raise exception 'This invite was already accepted or removed.' using errcode = 'P0002';
  end if;
  perform app.audit('revoke_teacher_invite', jsonb_build_object('invite_id', invite, 'label', removed_label));
end
$$;

-- Returns `true` iff an unused invite has the secret whose sha256 is `secret_hash`. Only reads, so the invite page can call it on a GET.
create or replace function app.teacher_invite_exists(secret_hash bytea)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.teacher_invite t where t.secret_hash = teacher_invite_exists.secret_hash)
$$;

-- Makes the caller a teacher and deletes the invite whose secret has the sha256 `secret_hash`, in one transaction.
--
-- Requires: the caller's platform role is `user`, else 42501, because the invite would not change a teacher and must not demote an admin, and
-- is then kept for the person it was meant for; an unused invite has that hash, else P0002.
--
-- The delete makes the invite single-use: of two callers accepting it at once, the second waits for the first's row lock, then finds no row.
create or replace function app.redeem_teacher_invite(secret_hash bytea)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.teacher_invite%rowtype;
begin
  if app.platform_role() is distinct from 'user' then
    raise exception 'Only an account without teacher rights can accept an invite.' using errcode = '42501';
  end if;
  delete from public.teacher_invite t where t.secret_hash = redeem_teacher_invite.secret_hash returning * into invite;
  if not found then
    raise exception 'This invite was already accepted or removed. Ask an admin for a new one.' using errcode = 'P0002';
  end if;
  update public.app_user set role = 'teacher' where user_id = (select auth.uid());
  perform app.audit('redeem_teacher_invite', jsonb_build_object('invite_id', invite.invite_id, 'label', invite.label, 'invited_by', invite.created_by));
end
$$;

-- Signed-in people only: `anon` has no account to promote and no reason to probe for invites.
revoke execute on function app.create_teacher_invite(text), app.revoke_teacher_invite(uuid), app.teacher_invite_exists(bytea), app.redeem_teacher_invite(bytea)
  from public, anon;
grant execute on function app.create_teacher_invite(text), app.revoke_teacher_invite(uuid), app.teacher_invite_exists(bytea), app.redeem_teacher_invite(bytea)
  to authenticated;
