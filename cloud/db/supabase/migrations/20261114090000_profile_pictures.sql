-- Profile pictures.
--
-- A person may have one picture, which the browser has already cropped to a square and encoded as WebP: the Worker
-- checks the bytes and stores them, and transforms nothing. The picture is an object in the bucket at
-- `pictures/<user_id>/<picture_id>.webp`; this table says which object is a person's current picture. Having none is
-- the absence of a row, not a null column, so that every reader of a row has a picture to show.
--
-- A new picture gets a new id rather than overwriting the old object, so its URL never changes meaning and a browser
-- may cache it for good; the replaced object is deleted by the Worker after the row has moved on.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table public.profile_picture (
  user_id    uuid primary key references public.app_user (user_id) on delete cascade,
  -- Names the object. Chosen by the Worker before it uploads, because the object exists before the row does.
  picture_id uuid not null unique,
  set_at     timestamptz not null default now()
);

alter table public.profile_picture enable row level security;
revoke all on public.profile_picture from public, anon, authenticated;

-- Whoever may read a person's profile may see their picture: themselves, anyone they share an edition with, and admins.
-- The same rule as `app_user_read`, so that a picture is never shown beside a name the reader could not see.
create policy profile_picture_read on public.profile_picture for select to authenticated using (
  user_id = (select auth.uid()) or app.shares_edition(user_id) or app.is_admin()
);
grant select on public.profile_picture to authenticated;

-- Makes the object `picture` the caller's picture and returns the id of the picture it replaced, or null when they had
-- none. The caller deletes the replaced object; until then it is unreachable, because the read route asks this table.
--
-- Requires: the caller is signed in and has a profile, else 42501; `picture` is no one's picture yet, else 23505 (the
-- Worker makes a fresh id for every upload, so a clash is a bug, not a race).
create or replace function app.set_profile_picture(picture uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  replaced uuid;
begin
  if me is null or not exists (select 1 from public.app_user where user_id = me) then
    raise exception 'Only a signed-in person with a profile can set a profile picture.' using errcode = '42501';
  end if;
  select p.picture_id into replaced from public.profile_picture p where p.user_id = me for update;
  insert into public.profile_picture (user_id, picture_id) values (me, picture)
  on conflict (user_id) do update set picture_id = excluded.picture_id, set_at = now();
  perform app.audit('set_profile_picture', jsonb_build_object('picture_id', picture, 'replaced', replaced));
  return replaced;
end
$$;

-- Removes the caller's picture and returns its id, for the caller to delete the object, or null when they had none.
-- Removing a picture that is not there succeeds and audits nothing.
--
-- Requires: the caller is signed in, else 42501.
create or replace function app.clear_profile_picture()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  removed uuid;
begin
  if me is null then
    raise exception 'Only a signed-in person can remove their profile picture.' using errcode = '42501';
  end if;
  delete from public.profile_picture p where p.user_id = me returning p.picture_id into removed;
  if removed is not null then
    perform app.audit('clear_profile_picture', jsonb_build_object('picture_id', removed));
  end if;
  return removed;
end
$$;

revoke execute on function app.set_profile_picture(uuid), app.clear_profile_picture() from public, anon;
grant execute on function app.set_profile_picture(uuid), app.clear_profile_picture() to authenticated;
