-- Invite links that make a teacher.
--
-- Until now an admin could make a teacher only by address, and only of an
-- account that already existed: the teacher had to log in once, tell the
-- admin, and wait. An invite turns that around. The admin makes a link and
-- sends it however they like; whoever opens it, signs in (which creates the
-- account if there is none) and accepts it, becomes a teacher. The link
-- works once.
--
-- An invite is a bearer secret, built the way a project token is: the
-- secret is shown once, when it is made, and only its sha256 is kept, so
-- neither a database dump nor an admin reading the list can recover a
-- link. The Worker hashes what the link carries and asks with the hash.
--
-- A used invite is deleted, in the same transaction that promotes its user,
-- and so is a revoked one. That is what makes "the list of unused invites"
-- the table itself, with no `used_at`/`used_by`/`revoked_at` columns that
-- would be null on every row the list shows: what happened to an invite is
-- in `audit_log`, which records who made it, who removed it and who used
-- it, with the invite's id and label in each entry.
--
-- An invite expires two weeks after it is made. Nothing asked for that, but
-- a link that hands out the right to create courses should not stay good in
-- an old mailbox forever; two weeks is long enough to be forwarded, read
-- after a holiday and used. An expired invite stays listed, marked, until an
-- admin removes it, so the admin sees that the person never got round to it.
--
-- Accepting makes a plain user a teacher and nothing else. A teacher or an
-- admin who opens a link is refused and the invite is left for whoever it
-- was meant for: it must never lower an admin to teacher, and spending it on
-- someone it changes nothing for would only waste it.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table public.teacher_invite (
  invite_id   uuid primary key default app.uuidv7(),
  -- sha256 of the secret in the link; the secret itself is never stored.
  secret_hash bytea not null unique check (octet_length(secret_hash) = 32),
  -- Who the admin meant it for, as they wrote it ("Prof. Rossi, OS course"),
  -- so the list says which link is which. Empty when they wrote nothing.
  label       text not null default '' check (length(label) <= 200),
  -- The admin who made it. An invite carries that admin's authority, so it
  -- goes with their account.
  created_by  uuid not null references public.app_user (user_id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  check (expires_at > created_at)
);

alter table public.teacher_invite enable row level security;
revoke all on public.teacher_invite from public, anon, authenticated;

-- Admins see every unused invite, never its hash: the hash is the one thing
-- a reader could try to match against a link. Writes are the functions below.
create policy teacher_invite_read on public.teacher_invite for select to authenticated using (app.is_admin());
grant select (invite_id, label, created_by, created_at, expires_at) on public.teacher_invite to authenticated;

-- Admin action: a new invite. Returns the secret, once; the Worker puts it
-- in the link and never sees it again.
create or replace function app.create_teacher_invite(label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  iid uuid;
begin
  if not app.is_admin() then
    raise exception 'only an admin may invite a teacher' using errcode = '42501';
  end if;
  -- 256 bits from two v4 uuids, as for project tokens; the prefix says what
  -- a leaked one is.
  secret := 'yk_invite_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.teacher_invite (secret_hash, label, created_by, expires_at)
  values (sha256(convert_to(secret, 'UTF8')), btrim(label), (select auth.uid()), now() + interval '14 days')
  returning invite_id into iid;
  perform app.audit('create_teacher_invite', jsonb_build_object('invite_id', iid, 'label', btrim(label)));
  return secret;
end
$$;
revoke execute on function app.create_teacher_invite(text) from public, anon;
grant execute on function app.create_teacher_invite(text) to authenticated;

-- Admin action: an unused invite stops working, at once. Any admin may
-- remove any admin's invite: they share one list.
create or replace function app.revoke_teacher_invite(invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone public.teacher_invite%rowtype;
begin
  if not app.is_admin() then
    raise exception 'only an admin may remove an invite' using errcode = '42501';
  end if;
  delete from public.teacher_invite t where t.invite_id = invite returning * into gone;
  if gone.invite_id is null then
    raise exception 'no such invite; it was used or removed already' using errcode = 'P0002';
  end if;
  perform app.audit('revoke_teacher_invite', jsonb_build_object('invite_id', gone.invite_id, 'label', gone.label));
end
$$;
revoke execute on function app.revoke_teacher_invite(uuid) from public, anon;
grant execute on function app.revoke_teacher_invite(uuid) to authenticated;

-- What the invite page shows before anyone accepts: 'open' for an invite
-- that would work now, 'expired', or 'unknown' for one that was used,
-- removed, or never existed, which are one answer because the link alone
-- cannot tell them apart and needs not to. Reads only; anyone signed in may
-- ask, since knowing a hash already means holding the link.
create or replace function app.teacher_invite_status(secret_hash bytea)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when t.expires_at > now() then 'open' else 'expired' end
       from public.teacher_invite t where t.secret_hash = teacher_invite_status.secret_hash),
    'unknown')
$$;
revoke execute on function app.teacher_invite_status(bytea) from public, anon;
grant execute on function app.teacher_invite_status(bytea) to authenticated;

-- The caller accepts the invite whose secret hashes to `secret_hash`: a
-- plain user becomes a teacher and the invite is gone, in one transaction.
-- The delete is what makes it single-use: two people accepting the same link
-- at once both reach it, the second waits for the first's row lock, finds the
-- row deleted, and is refused.
create or replace function app.redeem_teacher_invite(secret_hash bytea)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  role_now app.platform_role;
  used public.teacher_invite%rowtype;
begin
  select u.role into role_now from public.app_user u where u.user_id = me;
  if role_now is null then
    raise exception 'sign in first to accept an invite' using errcode = '42501';
  end if;
  if role_now <> 'user' then
    raise exception 'you are already a %, so this invite is left for the person it was meant for', role_now using errcode = '42501';
  end if;
  delete from public.teacher_invite t
  where t.secret_hash = redeem_teacher_invite.secret_hash and t.expires_at > now()
  returning * into used;
  if used.invite_id is null then
    if exists (select 1 from public.teacher_invite t where t.secret_hash = redeem_teacher_invite.secret_hash) then
      raise exception 'this invite has expired; ask an admin for a new one' using errcode = '42501';
    end if;
    raise exception 'this invite was used or removed; ask an admin for a new one' using errcode = 'P0002';
  end if;
  update public.app_user set role = 'teacher' where user_id = me;
  perform app.audit('redeem_teacher_invite', jsonb_build_object('invite_id', used.invite_id, 'label', used.label, 'invited_by', used.created_by));
end
$$;
revoke execute on function app.redeem_teacher_invite(bytea) from public, anon;
grant execute on function app.redeem_teacher_invite(bytea) to authenticated;
