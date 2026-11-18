-- Publishing from a GitHub repository without a token.
--
-- A project token is a secret a teacher copies into their repository's
-- settings. A link replaces it with a fact GitHub proves on every run: the
-- repository's own workflow asks GitHub for an OIDC token, the Worker
-- verifies it (issuer, audience, signature) and passes on what it says,
-- "this job runs in repository R of owner O, at ref F", exactly as a
-- verified Supabase JWT becomes `request.jwt.claims`. This file decides
-- everything from those facts; it cannot verify them itself, as it cannot
-- verify a JWT's signature. docs/cloud/github.md is the plan and its review.
--
-- A link binds a project to GitHub's numeric, immutable ids, as GitHub
-- returned them when an owner proved they administer the repository, never
-- to its name. npm's trusted publishing bound to owner/name until a first
-- publish, and left about 1,500 packages to whoever re-registered a freed
-- name ("SlugFest", 2026-10). Here, a rename keeps the link (the ids do not
-- change), a transfer to another owner breaks it (`owner_id` no longer
-- matches), and a deleted repository recreated under the same name has a
-- new id and publishes nothing.
--
-- Only a tag publishes. A per-link ref pattern was planned and dropped: it
-- protects nothing, since whoever can push to the repository can push any
-- tag or change the workflow's `on:`, and can read the hidden tests anyway.
-- A tag ruleset on GitHub is what restricts who may make tags.
--
-- A link lasts only as long as its maker owns the project. It is a
-- publishing credential the teacher keeps outside the cloud, as
-- administrator of their own repository; once they are no longer an owner
-- of the edition, it stops publishing rather than carrying on in the name
-- of somebody who is not a member.
--
-- Several projects may link one repository (the same exercise in two
-- editions): a job publishes to each. A project links at most one, so its
-- releases have one source.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- The Worker accepts only GitHub Actions' issuer (oidc.ts), so the issuer is
-- not stored. A second forge adds `issuer text not null default
-- 'https://token.actions.githubusercontent.com'` and new overloads of the
-- functions below, in an additive migration.
create table public.repository_link (
  link_id       uuid primary key default app.uuidv7(),
  -- Unique: a project's releases come from one repository. Linking again
  -- replaces the row (and its id).
  project_id    uuid not null unique references public.project (project_id) on delete cascade,
  -- GitHub's `repository_id` and `repository_owner_id`, as decimal text: the
  -- token's claims are strings, and text compares without a cast that could
  -- fail on input from outside. What a link binds to; nothing else is.
  repository_id text not null check (repository_id ~ '^[0-9]+$'),
  owner_id      text not null check (owner_id ~ '^[0-9]+$'),
  -- "owner/name" when linked, for display only: a rename does not update it,
  -- and nothing decides anything by it.
  repository    text not null check (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  -- The owner who linked it, and in whose name its releases are recorded.
  -- The link publishes only while this person owns the project's edition.
  linked_by     uuid not null references public.app_user (user_id) on delete restrict,
  linked_at     timestamptz not null default now()
);
-- What a CI job asks by: every link of one repository.
create index repository_link_repository on public.repository_link (repository_id);

-- The repository a release came from, the `repository` claim of the
-- verified token that published it; null for a release not made by a link.
-- A name and not a link id, because links are replaced and deleted and the
-- history must not lose its source. A rename shows from the next release.
alter table public.project_release add column published_from text;

alter table public.repository_link enable row level security;
revoke all on public.repository_link from public, anon, authenticated;

-- Staff of the project's edition see its link, read-only for assistants;
-- students see nothing. The functions below do every write, so there is no
-- insert, update or delete grant for anyone.
create policy repository_link_read on public.repository_link for select to authenticated using (
  exists (select 1 from public.project p where p.project_id = repository_link.project_id and app.may_edit_projects(p.edition_id))
);
grant select on public.repository_link to authenticated;

-- Links `project` to the repository whose GitHub ids are `repository_id`
-- and `owner_id`, displayed as `repository` ("owner/name"), replacing the
-- project's link if it has one, and returns the new link's id.
--
-- Requires: the caller owns the project's edition, else 42501: a link is a
-- publishing credential, made by whoever may make a token. The ids are
-- GitHub's answer, asked by the Worker with the caller's own GitHub token,
-- which also required admin or maintain on the repository; this function
-- cannot check that, and trusts the Worker for it as for a JWT's signature.
-- Ids that are not decimal, or a name that is not owner/name, are 23514.
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
  if not exists (select 1 from public.project p where p.project_id = link_repository.project and app.is_owner(p.edition_id)) then
    raise exception 'Only an owner of this edition can link a repository to its project.' using errcode = '42501';
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

-- Removes `project`'s link, so that its repository's jobs no longer publish
-- to it. Releases already made keep their `published_from`.
--
-- Requires: the caller owns the project's edition, else 42501; the project
-- has a link, else P0002.
create or replace function app.unlink_repository(project uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed public.repository_link%rowtype;
begin
  if not exists (select 1 from public.project p where p.project_id = unlink_repository.project and app.is_owner(p.edition_id)) then
    raise exception 'Only an owner of this edition can unlink its project''s repository.' using errcode = '42501';
  end if;
  delete from public.repository_link l where l.project_id = unlink_repository.project returning * into removed;
  if not found then
    raise exception 'This project is linked to no repository.' using errcode = 'P0002';
  end if;
  perform app.audit('unlink_repository', jsonb_build_object(
    'project_id', unlink_repository.project, 'link_id', removed.link_id,
    'repository', removed.repository, 'repository_id', removed.repository_id));
end
$$;

-- Whether the person who made a link still owns the project's edition. A
-- direct query on `enrollment`, not `app.is_owner`: that asks about
-- `auth.uid()`, and the publisher, who asks this, has none. Nobody calls it
-- but the two functions below.
create or replace function app.link_owner_current(linked_by uuid, edition uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.enrollment e
    where e.edition_id = link_owner_current.edition and e.user_id = link_owner_current.linked_by and e.role = 'owner'
  )
$$;
revoke execute on function app.link_owner_current(uuid, uuid) from public, anon, authenticated;

-- What a CI job in repository `repository_id` of owner `owner_id`, at
-- `ref`, may publish to: the facts of a verified token in, one row per link
-- of that repository out, for the Worker to turn into sentences.
--
-- For a link whose owner matches, a row carries the project's id, slug and
-- title, the edition's title (the course name) and label, and three
-- verdicts: `owner_matches` (true), `ref_matches` (only tags publish:
-- `ref` starts with `refs/tags/`) and `owner_current` (whoever linked it
-- still owns the edition). A release is accepted only where all three hold.
--
-- Links whose owner does not match, the repository having moved to another
-- owner, are told as one row with `owner_matches` false and every other
-- column null, however many there are: the new owner has no relation to
-- the course and learns that the repository moved, and not which projects,
-- or how many, it used to publish to.
--
-- No row at all means the repository is linked to nothing.
create or replace function app.ci_projects(repository_id text, owner_id text, ref text)
returns table (
  project_id    uuid,
  project_slug  text,
  project_title text,
  edition_title text,
  edition_label text,
  owner_matches boolean,
  ref_matches   boolean,
  owner_current boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  (select p.project_id, p.slug, p.title, e.title, e.label,
          true,
          coalesce(starts_with(ci_projects.ref, 'refs/tags/'), false),
          app.link_owner_current(l.linked_by, p.edition_id)
   from public.repository_link l
   join public.project p on p.project_id = l.project_id
   join public.course_edition e on e.edition_id = p.edition_id
   where l.repository_id = ci_projects.repository_id and l.owner_id = ci_projects.owner_id
   order by e.created_at, p.slug)
  union all
  (select null::uuid, null::text, null::text, null::text, null::text, false, null::boolean, null::boolean
   from public.repository_link l
   where l.repository_id = ci_projects.repository_id and l.owner_id is distinct from ci_projects.owner_id
   limit 1)
$$;

-- The publisher's write for a CI job: a release of `project`, whose id the
-- job chose (`release`, or null for the database to choose), from the
-- repository a verified token named. Returns the release id.
--
-- `repository_id`, `owner_id`, `ref`, `repository` and `commit_sha` are the
-- token's claims (`repository_id`, `repository_owner_id`, `ref`,
-- `repository`, `sha`), passed by the Worker from the verified token and
-- never from the request's body; the label is display text and is the
-- request's. The checks are made here again, whatever `app.ci_projects`
-- said, so a route cannot publish by skipping that question. Each refusal
-- is 42501 and says why in a sentence the job log can show:
--
--   * `project` is linked to this repository (by id);
--   * with the owner id it was linked with (else it moved);
--   * `ref` is a tag;
--   * whoever linked it still owns the project's edition.
--
-- The release is recorded as uploaded by whoever linked it (as a token's
-- release is by whoever made the token), with `published_from` the
-- repository's current name; the audit row holds the repository, its id,
-- the ref, the commit and the link. A duplicate release id is 23505, as for
-- every publish function, and stores nothing.
create or replace function app.publish_release_with_repository(
  repository_id text, owner_id text, ref text, repository text,
  project uuid, release uuid, label text, commit_sha text,
  starter_key text, starter_size bigint, starter_sha256 bytea,
  teacher_key text, teacher_size bigint, teacher_sha256 bytea
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  link    public.repository_link%rowtype;
  edition uuid;
  rid     uuid;
begin
  select l.* into link from public.repository_link l
  where l.project_id = publish_release_with_repository.project and l.repository_id = publish_release_with_repository.repository_id;
  if link.link_id is null then
    raise exception 'This repository is not linked to that project; an owner can link it on the project page.' using errcode = '42501';
  end if;
  if link.owner_id is distinct from publish_release_with_repository.owner_id then
    raise exception 'This repository moved to another owner; link it again on the project page.' using errcode = '42501';
  end if;
  if not coalesce(starts_with(publish_release_with_repository.ref, 'refs/tags/'), false) then
    raise exception 'Only tags publish; this run is at %.', coalesce(publish_release_with_repository.ref, 'no ref') using errcode = '42501';
  end if;
  select p.edition_id into edition from public.project p where p.project_id = link.project_id;
  if not app.link_owner_current(link.linked_by, edition) then
    raise exception 'The person who linked this repository is no longer an owner of this edition; an owner must link it again.' using errcode = '42501';
  end if;
  insert into public.project_release (release_id, project_id, label, commit_sha, starter_key, starter_size, starter_sha256,
                                      teacher_key, teacher_size, teacher_sha256, uploaded_by, published_from)
  values (coalesce(publish_release_with_repository.release, app.uuidv7()), link.project_id,
          publish_release_with_repository.label, publish_release_with_repository.commit_sha,
          publish_release_with_repository.starter_key, publish_release_with_repository.starter_size, publish_release_with_repository.starter_sha256,
          publish_release_with_repository.teacher_key, publish_release_with_repository.teacher_size, publish_release_with_repository.teacher_sha256,
          link.linked_by, publish_release_with_repository.repository)
  returning release_id into rid;
  -- Not app.audit: its actor is auth.uid(), and the publisher has none.
  insert into public.audit_log (actor, action, subject)
  values (link.linked_by, 'publish_release', jsonb_build_object(
    'project_id', link.project_id, 'release_id', rid, 'label', publish_release_with_repository.label,
    'link_id', link.link_id, 'repository', publish_release_with_repository.repository,
    'repository_id', publish_release_with_repository.repository_id,
    'ref', publish_release_with_repository.ref, 'commit_sha', publish_release_with_repository.commit_sha));
  return rid;
end
$$;

-- An owner links and unlinks from the project page, signed in.
revoke execute on function app.link_repository(uuid, text, text, text), app.unlink_repository(uuid) from public, anon;
grant execute on function app.link_repository(uuid, text, text, text), app.unlink_repository(uuid) to authenticated;

-- A CI job, as the publisher, asks and publishes, and does nothing else:
-- still no table grant, and nobody signed in may publish as a repository.
revoke execute on function app.ci_projects(text, text, text),
  app.publish_release_with_repository(text, text, text, text, uuid, uuid, text, text, text, bigint, bytea, text, bigint, bytea)
  from public, anon, authenticated;
grant execute on function app.ci_projects(text, text, text),
  app.publish_release_with_repository(text, text, text, text, uuid, uuid, text, text, text, bigint, bytea, text, bigint, bytea)
  to yukibana_publisher;
