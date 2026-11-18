-- A course belongs to the people in its editions; admins run them all.
--
-- A mistake, written down. `course_read` let every teacher read every course, so that the home page could offer "add an edition" to any of
-- them, and `app.create_edition` let any teacher add an edition to any course. Together they meant a teacher saw the code and the latest
-- edition's name of every course on the platform, other teachers' included, and could put an edition of their own under one of them. That
-- edition was empty, because creating an edition copies nothing (copying is `app.duplicate_edition`, which only an owner of the source may
-- do), and it hung under another teacher's course, changing the name that course showed. Reported 2026-11.
--
-- Now:
--
--   * A course is created with its first edition, by `app.create_course`, so there is no course without somebody on a roster. A course is
--     visible to whoever can see one of its editions, and only an owner of one of its editions may add another.
--   * A course's name is no longer readable from the course. `course.title` followed the course's latest edition, and somebody in last
--     year's edition is not in this year's: reading it told them what an edition they are not part of is called. The column grant leaves it
--     out, the trigger that kept it in step is gone (it is now the name the course was created with, which nothing reads), and
--     `app.course_name` gives the name of the latest edition the caller can see.
--   * An admin is owner and staff of every edition, without being on its roster: `app.is_owner` and `app.is_staff` say so, and every policy
--     and function that asks them follows. An admin sees and manages any edition, its projects and its submissions, with the pages owners
--     use.
--   * Publishing credentials stay with the owners on the roster. A project token was always checked against `role_in`. A repository link
--     publishes only while whoever made it owns the edition by enrolment (`app.link_owner_current`), so an admin's link would be accepted and
--     then never publish: `app.link_repository` now asks for an enrolled owner. Unlinking stays with `app.is_owner`, so an admin can take a
--     link away.
--
-- A teacher outside a course learns one thing about it: that its code is taken, because codes are unique across the platform.
--
-- A course created before this, with no edition, is seen by admins only.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Whether the caller is staff (assistant or owner) of `edition`, or an admin. Never null.
create or replace function app.is_staff(edition uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(app.role_in(edition) in ('assistant', 'owner'), false) or app.is_admin()
$$;

-- Whether the caller owns `edition`, or is an admin. Never null: false for a stranger (see 20261008120000).
create or replace function app.is_owner(edition uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(app.role_in(edition) = 'owner', false) or app.is_admin()
$$;

drop policy edition_read on public.course_edition;
create policy edition_read on public.course_edition for select to authenticated using (
  app.role_in(edition_id) is not null or app.is_admin()
);

-- Through `edition_read`, so a course is exactly as visible as its editions.
drop policy course_read on public.course;
create policy course_read on public.course for select to authenticated using (
  exists (select 1 from public.course_edition e where e.course_id = course.course_id)
);

revoke select on public.course from authenticated;
grant select (course_id, code) on public.course to authenticated;

drop trigger course_follows_latest_edition on public.course_edition;
-- Called by nothing once its trigger is gone.
-- squawk-ignore ban-drop-function
drop function app.follow_latest_edition();

-- Returns the name of the latest edition of `course` the caller can see (enrolled in, or any for an admin); null for a course they cannot.
-- Ties on `created_at` (two editions in one transaction) fall to the time-ordered id. Security definer with the visibility rule spelled
-- out, so that `app.create_edition` (itself a definer, where policies do not apply) gets the same answer as a page.
create or replace function app.course_name(course uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.title from public.course_edition e
  where e.course_id = course and (app.role_in(e.edition_id) is not null or app.is_admin())
  order by e.created_at desc, e.edition_id desc
  limit 1
$$;

-- Returns whether the caller may add an edition to `course`: a teacher who owns one of its editions (an admin owns them all). Never null.
-- Owners and not assistants: the new edition makes its maker its owner, so an assistant who could do this would be making themselves an
-- owner of the course. Security definer to see editions the caller is not in.
create or replace function app.may_add_edition(course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_teacher() and exists (
    select 1 from public.course_edition e
    where e.course_id = course and app.is_owner(e.edition_id)
  )
$$;

-- The two-argument form made a course with nobody on it. Left in place it would still be callable, and the course it made visible to nobody.
-- squawk-ignore ban-drop-function
drop function app.create_course(text, text);

-- Creates a course coded `code`, its first edition labelled `label` and named `title`, and makes the caller that edition's owner, in one
-- transaction. Returns the edition's id.
--
-- Requires: the caller is a teacher or an admin, else 42501. A code another course has is 23505 (`course_code_key`).
create or replace function app.create_course(code text, title text, label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid  uuid;
  eid  uuid;
  addr text;
begin
  if not app.is_teacher() then
    raise exception 'only a teacher may create a course' using errcode = '42501';
  end if;
  select lower(u.email) into addr from auth.users u where u.id = (select auth.uid());
  insert into public.course (code, title, created_by)
  values (code, title, (select auth.uid()))
  returning course_id into cid;
  insert into public.course_edition (course_id, label, title)
  values (cid, label, title)
  returning edition_id into eid;
  insert into public.enrollment (edition_id, email, role, user_id)
  values (eid, addr, 'owner', (select auth.uid()));
  perform app.audit('create_course', jsonb_build_object('course_id', cid, 'code', code, 'edition_id', eid, 'label', label));
  return eid;
end
$$;
revoke execute on function app.create_course(text, text, text) from public, anon;
grant execute on function app.create_course(text, text, text) to authenticated;

-- Creates an edition of `course` labelled `label`, named after the latest edition the caller can see (not the course's latest, which may be
-- somebody else's), and makes the caller its owner. Returns its id.
--
-- Requires: `app.may_add_edition(course)`, else 42501, the same refusal for a course that exists and one that does not, so the function
-- cannot be used to ask whether an id is a course. A label the course already has is 23505.
create or replace function app.create_edition(course uuid, label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid  uuid;
  addr text;
begin
  if not app.may_add_edition(course) then
    raise exception 'only an owner of one of its editions may add an edition to a course' using errcode = '42501';
  end if;
  select lower(u.email) into addr from auth.users u where u.id = (select auth.uid());
  insert into public.course_edition (course_id, label, title)
  values (course, label, app.course_name(course))
  returning edition_id into eid;
  insert into public.enrollment (edition_id, email, role, user_id)
  values (eid, addr, 'owner', (select auth.uid()));
  perform app.audit('create_edition', jsonb_build_object('edition_id', eid, 'course_id', course, 'label', label));
  return eid;
end
$$;

-- As in 20261118090000, except for who may: an owner on the edition's roster, not `app.is_owner`, which now includes admins. A link
-- publishes only while its maker owns the edition by enrolment (`app.link_owner_current`), so an admin's would be accepted and then refuse
-- every release.
--
-- Requires: the caller owns the project's edition by enrolment, else 42501. Ids that are not decimal, or a name that is not owner/name, are
-- 23514.
create or replace function app.link_repository(project uuid, repository_id text, owner_id text, repository text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.repository_link%rowtype;
  id uuid;
begin
  if not exists (select 1 from public.project p where p.project_id = link_repository.project and app.role_in(p.edition_id) = 'owner') then
    raise exception 'Only an owner on this edition''s roster can link a repository to its project.' using errcode = '42501';
  end if;
  delete from public.repository_link l where l.project_id = link_repository.project returning * into previous;
  insert into public.repository_link (project_id, repository_id, owner_id, repository, linked_by)
  values (link_repository.project, link_repository.repository_id, link_repository.owner_id, link_repository.repository, (select auth.uid()))
  returning link_id into id;
  perform app.audit('link_repository', jsonb_build_object(
    'project_id', link_repository.project, 'link_id', id,
    'repository', link_repository.repository, 'repository_id', link_repository.repository_id, 'owner_id', link_repository.owner_id,
    'replaced', case when previous.link_id is null then null
                     else jsonb_build_object('link_id', previous.link_id, 'repository', previous.repository, 'repository_id', previous.repository_id) end));
  return id;
end
$$;
