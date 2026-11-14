-- Who sees a person's name and picture, chosen by that person, for each separately.
--
-- Three audiences: only themselves (`private`), people who share a course edition with them (`courses`, which was the
-- rule for both until now and stays the default), and everyone signed in to Yukibana (`public`). There are no
-- organisations in the model; the people in your courses are the nearest thing, and the audience is named after what
-- it is.
--
-- A row policy cannot hide one column of a row, and a roster must still list a person whose name is private: so the
-- name is no longer readable from the table at all. `app.visible_name` is the one way to read it, and answers with
-- the name only to whom its owner chose. The picture is a row of its own, so its policy decides directly.
--
-- The name also becomes the person's to set. Until now the login trigger wrote the identity provider's name over it
-- at every login; it now fills it in only while there is none.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

create type app.profile_audience as enum ('private', 'courses', 'public');

-- Constant defaults, so adding the columns rewrites nothing and every existing person keeps today's rule.
alter table public.app_user
  add column name_audience    app.profile_audience not null default 'courses',
  add column picture_audience app.profile_audience not null default 'courses';

-- `true` iff the caller may see what `owner` showed to `audience`: always their own; with `public`, anyone signed in;
-- with `courses`, someone who shares an edition with `owner`; with `private`, nobody else. Admins get no exception:
-- "only me" means only me. False, not null, for a caller who is not signed in or an `owner` that is null.
create or replace function app.sees(owner uuid, audience app.profile_audience)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null and owner is not null and (
      owner = (select auth.uid())
      or audience = 'public'
      or (audience = 'courses' and app.shares_edition(owner))
    ),
    false)
$$;

-- The name `person` set, when the caller may see it (`app.sees` with their `name_audience`), else null, as it is for a
-- person who set none or a `person` that is null (an enrolment not yet linked to an account). Security definer, so it
-- reads the column that `authenticated` may not, and so it answers for a person whose row the caller cannot see when
-- their name is public.
create or replace function app.visible_name(person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.full_name from public.app_user u where u.user_id = person and app.sees(u.user_id, u.name_audience)
$$;

-- Every column of a profile but the name, which `app.visible_name` reads. The table-wide grant would otherwise win over
-- any column revoke.
revoke select on public.app_user from authenticated;
grant select (user_id, github_login, role, created_at, name_audience, picture_audience) on public.app_user to authenticated;

-- The name changed through the table, unchecked and unaudited; `app.set_profile` replaces that.
revoke update (full_name) on public.app_user from authenticated;
drop policy app_user_update_self on public.app_user;

-- `true` iff the caller may see `owner`'s picture (`app.sees` with their `picture_audience`). Security definer, so it
-- reads the audience of a person whose profile row the caller cannot see: a public picture of a stranger.
create or replace function app.sees_picture(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.sees(u.user_id, u.picture_audience) from public.app_user u where u.user_id = owner), false)
$$;

-- The picture: its owner, and whom its owner chose. Replaces the rule that copied `app_user_read`.
drop policy profile_picture_read on public.profile_picture;
create policy profile_picture_read on public.profile_picture for select to authenticated using (app.sees_picture(user_id));

-- Sets the caller's name to `name`, trimmed (an empty name is none, and screens show the login or the address), and
-- who sees it and their picture. Audited with the audiences, not the name.
--
-- Requires: the caller is signed in with a profile, else 42501; `name` is at most 100 characters once trimmed, else
-- 23514, which the Worker shows as it is.
create or replace function app.set_profile(name text, name_audience app.profile_audience, picture_audience app.profile_audience)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  trimmed text := nullif(btrim(name), '');
begin
  if me is null then
    raise exception 'Only a signed-in person can change their profile.' using errcode = '42501';
  end if;
  if length(trimmed) > 100 then
    raise exception 'A name is at most 100 characters.' using errcode = '23514';
  end if;
  update public.app_user u
     set full_name = trimmed, name_audience = set_profile.name_audience, picture_audience = set_profile.picture_audience
   where u.user_id = me;
  if not found then
    raise exception 'Only a signed-in person with a profile can change it.' using errcode = '42501';
  end if;
  perform app.audit('set_profile', jsonb_build_object('name_audience', name_audience, 'picture_audience', picture_audience));
end
$$;

revoke execute on function app.set_profile(text, app.profile_audience, app.profile_audience) from public, anon;
grant execute on function app.set_profile(text, app.profile_audience, app.profile_audience) to authenticated;
revoke execute on function app.visible_name(uuid), app.sees(uuid, app.profile_audience), app.sees_picture(uuid) from public, anon;
grant execute on function app.visible_name(uuid), app.sees(uuid, app.profile_audience), app.sees_picture(uuid) to authenticated;

-- The login trigger, as in 20260918090200_courses.sql, except that the provider's name fills in a missing name rather
-- than replacing the one the person set.
create or replace function app.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_user (user_id, full_name, github_login)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    lower(nullif(coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username'), ''))
  )
  on conflict (user_id) do update
    set full_name    = coalesce(public.app_user.full_name, excluded.full_name),
        github_login = coalesce(excluded.github_login, public.app_user.github_login);

  if new.email_confirmed_at is not null and new.email is not null then
    perform app.link_enrollments(new.id, new.email);
  end if;
  return new;
end
$$;
