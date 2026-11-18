# Publishing from GitHub without a token: the plan

2026-11-18. Status: plan, reviewed. This page becomes the feature's
documentation once it is built; until then it is the plan the
implementation follows, stage by stage. Paths are from the repository's
root. What the review changed, and what it turned down, is at the end.

## What changes for a teacher

Today a release from CI takes: make the project, make a token on the
project page, copy it, open the repository's settings, add the secret, add
the variable, make sure the workflow is there, push a tag.

After this:

1. On the project page, an owner presses **Connect GitHub** once. GitHub asks
   them to authorise the Yukibana Cloud GitHub App. The first time, or for a
   repository the App cannot see yet, they press **Install the App or add
   repositories** and choose the accounts or organisations, and the
   repositories, the App may see.
2. They **pick an existing repository** from the ones the App can see, or type
   its `owner/name`. To start from a template, they make the repository on
   GitHub's own "Use this template" page, which the project page links to
   when a template is configured, then come back and pick it like any other.
3. That is all. Pushing a tag (`refs/tags/…`) runs the repository's own
   workflow on GitHub's runners, which builds the archives with the CLI and
   publishes them, proving where it runs with GitHub's OIDC token instead of
   a secret.

Project tokens and `yukibana publish` as a logged-in person keep working
exactly as they do.

## Principles kept, and the one stretched

* **The cloud transforms nothing.** Builds happen on GitHub's runners, in the
  repository's own workflow, with the same CLI. The cloud receives two
  archives as today. No webhooks, no reading repositories, no creating them.
* **Authorisation lives in Postgres.** Who may link a repository to a
  project, and which repository may publish to which project, are a table,
  its policies and `security definer` functions, with pgTAP negatives.
* **Facts from outside are established by the Worker, at a boundary, and
  passed in.** Two new facts come from GitHub: "this CI job runs in
  repository R of owner O, at ref F, on commit S" (a verified OIDC token,
  exactly as a verified Supabase JWT becomes `request.jwt.claims`) and "this
  person administers repository R" (asked of GitHub with their own token, at
  link time). The database decides everything from those facts; it cannot
  verify them itself, just as it cannot verify a JWT's signature today. What
  the token proves is taken from the token, never from the request's body.
* **Least power per credential.** The OIDC token is short-lived, minted per
  job by GitHub, and never stored. `yukibana_publisher` still has no table
  grant. The App asks for nothing but repository metadata. The GitHub user
  token is held for fifteen minutes at most, encrypted and bound to the
  person who connected, in a `__Host-` cookie; it is deleted once a link is
  made and revoked at logout, and never stored server-side.

## The identity a link binds to (and what npm got wrong)

A link binds a project to `(repository_id, owner_id)`: GitHub's numeric,
immutable ids, as GitHub returns them when the link is made. Names are for
display only.

* A **rename** keeps the link (the id does not change). The link shows the
  name it had when it was made; each release records the `repository` claim
  of the token that published it, so new releases show the new name.
* A **transfer** to another owner breaks it: `owner_id` no longer matches, and
  the job is told so in words ("this repository moved to another owner;
  link it again on the project page"), not just "no projects". It is told
  nothing else: the new owner has no relation to the course, and learns no
  project's id or title.
* A **deleted and recreated** repository of the same name has a new id and
  publishes nothing.

npm's trusted publishing bound to owner/repo names until a first publish,
which left about 1,500 packages open to whoever re-registered a freed name
("SlugFest", disclosed 2026-10-13). PyPI resolves and stores the owner's id
when a publisher is configured. We bind ids immediately, because GitHub
hands them to us at link time, so there is no window at all.

Only `push` and `workflow_dispatch` events may publish (an allow list: npm
learned with `issue_comment` that a deny list misses one), and only from a
tag. A per-link pattern was planned and dropped: it protects nothing,
because whoever can push to the repository can push any tag or change the
workflow's `on:`, and can read the hidden tests in it anyway. What restricts
who may create tags is a GitHub tag ruleset. A `workflow_dispatch` run
publishes only when it is started on a tag.

A link also lasts only as long as its maker owns the project. A link is a
credential the teacher keeps outside the cloud, as administrator of their
own repository, so when they are removed from the edition or are no longer
an owner of it, the link stops publishing ("the person who linked this
repository is no longer an owner of this edition; an owner must link it
again") instead of carrying on in the name of somebody who is not a member.

## Many projects, one repository

Several projects may link the same repository (the same exercise in two
editions, for instance). A project links at most one repository, so a
project's releases have one source. When a job runs, the CLI asks the cloud
which projects this repository publishes to, and publishes to each of them:
one build per project (the starter carries the project's id and a fresh
release id), one request each. Releases are independent; a failure for one
project does not stop the others, and the job fails at the end naming every
failure. A re-run publishes again, as a re-run with a token does today: a
release of identical content costs a student at most an update that changes
no file.

Because of that fan-out, **linking requires proof of control**. Otherwise a
stranger could link somebody's private course repository to a project of
their own, and that repository's CI would push its hidden tests into the
stranger's project. Linking therefore asks GitHub, with the teacher's own
token, for the repository, and requires `permissions.admin` or
`permissions.maintain`. The job log lists every project it publishes to, so
a repository's administrators can see the links. On a public repository the
job log is public, and so are the titles of the projects and editions it
names.

The other side of the fan-out is who may publish. Anyone who can push a tag,
or run a workflow, in a linked repository can publish to every project
linked to it, exactly as anyone with write access can read a token secret
today. Give write access to the course repository only to people you would
give the project's publishing token, and protect tags with a ruleset where
your plan allows it.

## Stage 1: the database

One migration, `cloud/db/supabase/migrations/<timestamp>_repository_links.sql`,
and `cloud/db/supabase/tests/repository_links.test.sql`.

```sql
-- The Worker accepts only GitHub Actions' issuer (oidc.ts), so the issuer is
-- not stored. A second forge adds `issuer text not null default
-- 'https://token.actions.githubusercontent.com'` and new overloads of the
-- functions below, in an additive migration.
create table public.repository_link (
  link_id       uuid primary key default app.uuidv7(),
  project_id    uuid not null unique references public.project (project_id) on delete cascade,
  repository_id text not null check (repository_id ~ '^[0-9]+$'),
  owner_id      text not null check (owner_id ~ '^[0-9]+$'),
  repository    text not null,           -- "owner/name" when linked, display only
  linked_by     uuid not null references public.app_user (user_id) on delete restrict,
  linked_at     timestamptz not null default now()
);
create index repository_link_repository on public.repository_link (repository_id);
-- The repository a release came from, from the verified token's claim; null
-- for a release not made by a link. A name and not a link id, because links
-- are replaced and deleted and the history must not lose its source.
alter table public.project_release add column published_from text;
```

* RLS on; `select` for staff of the project's edition (`app.may_edit_projects`),
  nothing for students. `revoke all on public.repository_link from public,
  anon, authenticated; grant select on public.repository_link to
  authenticated;`, as for `teacher_invite`; the policy then narrows it. No
  insert, update or delete grant for anyone.
* `app.link_repository(project, repository_id, owner_id, repository) returns uuid`:
  owners only (`app.role_in(edition) = 'owner'`, as for tokens: a link is a
  publishing credential); replaces the project's link if there is one;
  audit row.
* `app.unlink_repository(project)`: owners only; audit row.
* `app.ci_projects(repository_id, owner_id, ref)`, for `yukibana_publisher`:
  one row per link with that repository id, with `owner_matches`,
  `ref_matches` (`starts_with(ref, 'refs/tags/')`) and `owner_current` (see
  below). Only rows where `owner_matches` holds carry `project_id`, the
  project's slug and title and the edition's title; a row for a moved
  repository carries the flag alone. The Worker turns the booleans into
  sentences.
* `app.publish_release_with_repository(repository_id, owner_id, ref, repository, project, release, label, commit_sha, keys and sizes and digests…) returns uuid`,
  for `yukibana_publisher`: refuses (42501, in words) unless a link for
  `(project, repository_id)` exists with a matching owner, `ref` starts with
  `refs/tags/`, and `linked_by` still has an `enrollment` row with role
  `'owner'` in the project's edition. That last check is a direct query on
  `public.enrollment`, not `app.role_in`, which relies on `auth.uid()`, and
  the publisher has none. It inserts the release with `uploaded_by =
  linked_by` and `published_from = repository`; audit row with the
  repository, repository id, ref and commit.
* Grants, each a revoke and an explicit grant, as every function here has
  them (there are no default privileges): execute on `app.ci_projects` and
  `app.publish_release_with_repository`, with their full signatures, revoked
  from `public, anon, authenticated` and granted to `yukibana_publisher`;
  execute on `app.link_repository` and `app.unlink_repository` revoked from
  `public, anon` and granted to `authenticated`.

pgTAP negatives: a student, an assistant, and an owner of another edition
cannot link or unlink; a student reads no link; nobody can insert into the
table directly; `yukibana_publisher` has no `select` on the table and
`authenticated` no `execute` on `app.publish_release_with_repository`; a
wrong owner id, a branch ref, an unlinked project, and a project linked to
another repository are each refused; a repository linked to A cannot publish
to B; after the linking owner's enrolment is deleted, and after it is
changed to assistant, publishing by link is refused and stores no row; with
a mismatched owner id, `app.ci_projects` returns no project id, slug or
title. Positives that prove the negatives are not vacuous: the publisher can
call `app.ci_projects` for a linked repository, an owner can call
`app.link_repository`, and a release by link records `published_from` and
`uploaded_by`.

## Stage 2: the Worker, for CI

* `cloud/web/src/lib/server/oidc.ts`:
  * `GITHUB_ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com'`.
  * `ciIdentityOf(payload): CiIdentity | string` — pure: narrows the claims
    (`repository_id`, `repository_owner_id`, `repository`, `ref`, `sha`,
    `event_name`) and refuses events other than `push` and
    `workflow_dispatch`. Unit-tested as a table.
  * `verifyCiToken(token, audience, keys = githubKeys)`: jose `jwtVerify`
    with `issuer`, `audience`, `algorithms: ['RS256']`, then
    `ciIdentityOf`. `keys` is injectable so the integration suite signs its
    own tokens with a local key set. A refusal for the audience says "this
    token is for <aud>; this registry expects <expected>", one for the
    issuer names the expected issuer. GitHub Enterprise's custom issuers are
    not supported, and are refused like any other.
  * `isCiToken(bearer)`: an unverified peek at `iss`, a routing hint and
    nothing more. Every CI route calls `verifyCiToken` itself and answers
    401 for anything else.
* The audience is `siteOrigin(config.siteUrl, event.url)` from `connect.ts`,
  the same canonical origin the IDE login uses: `SITE_URL` in production and
  in preview versions, the request's origin only locally. The CLI asks for
  the origin of the registry URL it was given (Stage 4), so a trailing slash
  or a path makes no difference.
* `session.ts`: `identify` returns `{ claims: null, refused: null, by:
  'bearer' }` for a bearer that is a project token or carries a non-Supabase
  `iss`, so it is neither refused nor reported as a bad session. Whenever an
  `Authorization: Bearer` header is present, cookies are never read: a fake
  GitHub-looking bearer sent with a teacher's cookies is nobody, not the
  teacher. `forgery` lets bearer requests through on exactly that promise.
* `Publisher` (`releases.ts`) gains `{ kind: 'ci'; identity: CiIdentity }`.
  `publishRelease` checks the project is among `app.ci_projects` (refusing
  with the reason) before storing a byte, and records with
  `app.publish_release_with_repository`. For a CI publisher the commit is
  `identity.sha`: a form `commit` that differs from it is a 400 and stores
  nothing. The ref, the repository and the ids passed to the database come
  from the verified identity only, never from form fields, and so do the
  audit row's ref and sha. The label stays a form value, as today: it is
  display text, not provenance.
* `cloud/web/src/routes/api/projects/[project]/releases/+server.ts`: before
  the session branch, `isCiToken(bearer)` leads to `verifyCiToken(bearer,
  audience)`, which builds the CI publisher; a failure is a 401 saying "CI
  token refused: <reason>". Without this branch the route would send the
  bearer to `requireBearer`, and every CI token would be refused as a bad
  session.
* `GET /api/ci/projects` (CI bearer only, verified the same way): `{
  repository, ref, sha, projects: [{ id, slug, title, edition, refused:
  string | null }] }`. A project whose ref does not match, or whose linking
  owner is no longer an owner, is listed with the reason, so the job log can
  say why it was skipped ("only tags publish; this run is at
  refs/heads/main"). A moved repository is listed as the one sentence about
  moving, with no project.
* Shapes in `cloud/web/src/lib/api.ts`; the client decodes them in
  `packages/client/src/lib/wire.ts`.
* Integration tests (`cloud/web/tests/integration/ci.test.ts`) call the
  server modules directly with a local key set: a token publishing to two
  linked projects; a wrong audience (the refusal names the expected one), a
  wrong issuer, an expired token, a `pull_request` event, a branch ref, a
  moved owner, and a form commit that differs from the token's `sha` are
  each refused and store no row or object. Over HTTP: a CI-shaped token to
  the releases route and to `/api/ci/projects` gets the CI refusal and
  stores nothing; a bearer with GitHub's `iss`, sent with a signed-in
  teacher's cookies, is nobody on a POST to `/api/editions` and on a page
  action, and changes nothing.

## Stage 3: the Worker, for the teacher

* Config (`env.ts`): `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and
  `GITHUB_APP_SLUG`. The feature is off (and the page says nothing about
  GitHub) unless all three are set. `GITHUB_TEMPLATE` (`owner/name`) is
  optional and has no default (see the template, below).
* No App private key is needed: everything is done with the person's own
  user-to-server token, which can do only what both the App and the person
  may, and the App may only read metadata.
* `cloud/web/src/lib/server/github.ts`: a small typed client over `fetch`
  (`exchangeCode`, `installations`, `installationRepositories`,
  `repositoryById`, `repositoryByName`, `revokeToken`), an interface so tests
  can stub it, every response narrowed from `unknown` at the boundary.
* `cloud/web/src/lib/server/github-cookie.ts`: AES-GCM seal/open of
  `{ token, expires, sub }` into `__Host-yukibana-github` (Secure, HttpOnly,
  SameSite Lax, path `/`, fifteen minutes), where `sub` is the signed-in
  person's Supabase id when the cookie is set. The key is derived with
  HKDF-SHA-256 from `GITHUB_APP_CLIENT_SECRET` (info
  `yukibana-github-cookie`, empty salt), so there is no secret of its own to
  provision; rotating the client secret only invalidates fifteen minutes of
  cookies. `open(cookie, key, sub)` returns null when the sealed `sub` is
  not the current claims' `sub`, and the caller then deletes the cookie.
  Without that binding, on a shared machine, a second teacher signing in
  after the first could link the first teacher's private repository to a
  project of their own with the first teacher's proof of control, and the
  first teacher's next tag would send the hidden tests there.
* Routes, following the sibling-subdomain rules:
  * `POST ?/connectGithub` on the project page (a same-origin form, as every
    cookie write): sets `__Host-yukibana-github-state` (random, ten minutes,
    with the project id and the person's `sub`) and redirects to GitHub's
    authorize URL. With a field `install=1` (the button **Install the App or
    add repositories**) it sets the same cookie and redirects to
    `https://github.com/apps/<GITHUB_APP_SLUG>/installations/new?state=<state>`
    instead; with "Request user authorization during installation" on,
    GitHub comes back to the same return route with `code` and `state`.
    Connect itself stays on the authorize URL, because for somebody who has
    installed the App already, `installations/new` is a settings screen that
    may not come back.
  * `GET /auth/github/return?code&state`: refused before anything else unless
    `state` equals the state cookie and the cookie's `sub` is the current
    session's. A refused return deletes no cookie and calls GitHub not at
    all; a return with no state cookie, as when somebody installs the App
    from github.com, gets a page saying "The App is installed; go back to the
    project page and press Connect GitHub." Then it exchanges the code, sets
    the token cookie, clears the state cookie, and redirects to the project
    page. `installation_id` and `setup_action` are ignored: the installations
    are listed again with the token. Like `/auth/callback`, its one side
    effect is a cookie only this host can set.
  * The project page `load` (owners only) lists installations and
    repositories only when the token cookie is present and the project has
    no link, or the URL has `?relink`: a read. Per installation it reads one
    page (`per_page=100`) of `/user/installations/{id}/repositories`, skips
    repositories whose `permissions` lack admin and maintain, and stops after
    ten installations, so its requests stay well under the Worker's
    subrequest limit (fifty on the free plan) even for an organisation with
    thousands of repositories. A GitHub error or rate limit is caught,
    reported with `report('github', …)` and shown as a sentence in the
    Repository section ("GitHub did not answer; Refresh or Connect again"); it
    never fails the `load`, which also shows tokens and releases.
  * `POST ?/linkRepository` (`repository_id`, or `owner/name` typed for a
    repository not listed): asks GitHub for the repository by id, or by name
    with `GET /repos/{owner}/{name}`, with the person's token, requires admin
    or maintain, then calls `app.link_repository` with the ids GitHub
    returned. After a successful link it deletes `__Host-yukibana-github`:
    nothing needs the token any more.
  * `POST ?/unlinkRepository`.
  * `/auth/logout` also revokes the GitHub token, if the cookie holds one for
    this person, with `DELETE /applications/{client_id}/token` (best effort,
    reported on failure), and deletes `__Host-yukibana-github` and
    `__Host-yukibana-github-state`.
* The page: a "Repository" section for owners showing the link (repository,
  who linked it, last publish: the newest release of the project with
  `published_from` set) with Unlink and Change; otherwise Connect, then the
  picker and an `owner/name` field. When the picker is empty or truncated it
  says so ("not listed? type owner/name, or install the App on its account
  or add it to the installation; in an organisation an owner may have to
  approve"), with the install button and a Refresh link to the project page,
  which lists again with the same token. When `GITHUB_TEMPLATE` is set, a
  plain link to `https://github.com/<GITHUB_TEMPLATE>/generate` (new tab),
  with a sentence telling the teacher to come back and pick the new
  repository. The workflow snippet to paste is always there, in a collapsed
  details element: the Worker cannot tell cheaply whether a repository has
  it. Staff who are not owners see the link read-only. The release list says
  "from <published_from>" for a release by link, as it says "by token"
  today.
* The template. The App does not create repositories: GitHub's own "Use this
  template" page does, with the teacher's own rights, and handles taken
  names, organisations that forbid it, and generation that is not done yet.
  `GITHUB_TEMPLATE` is set only once the template it names has a workflow
  with `permissions: id-token: write` and the `--ci` Action (Luis's template
  with the Stage 4 patch merged, or a template under Yukibana-Ed), and
  therefore not before Stage 4 has shipped.
* Unit tests: cookie sealing (tampered, expired, a cookie sealed under
  another client secret, and "a GitHub cookie sealed for another person is
  not used"), the GitHub client's narrowing against recorded responses, the
  permission check. Return-route cases, with a stubbed GitHub client: an
  install-shaped callback (`code`, `installation_id`, `setup_action=install`,
  a `state`) without the state cookie is refused, sets no cookie and calls
  GitHub not at all; a state cookie made for another person is refused the
  same way. `sibling.test.ts` covers the new routes like every route.

## Stage 4: the CLI, the client and the Action

This stage ships before any template link is offered (Stage 3).

* `packages/client`: `YukibanaClient` gains `ciProjects()`, and accepts the
  OIDC token as its bearer like any other.
* `yukibana publish --ci` (`packages/cli`). CI mode is only ever explicit;
  `--ci` with `--token` or `--project` is an error. In `release()`, it is
  decided first, before `projectOf`, and goes to a separate `publishCi(inv,
  dir, folder)`. That ignores `YUKIBANA_PROJECT` and any `projectId` in
  `yukibana.json` (warning when one is set), requests an OIDC token
  (`ACTIONS_ID_TOKEN_REQUEST_URL&audience=…` with
  `ACTIONS_ID_TOKEN_REQUEST_TOKEN`) for the audience `client.origin`, fresh
  for each request and never printed; asks `/api/ci/projects`; prints every
  project and why any is skipped; and for each remaining one runs
  `newReleaseId()`, `build(dir, folder, project.id, releaseId)` and
  `publishRelease`. It exits non-zero naming every failure. No linked
  projects is a failure with a sentence pointing at the project page.
* CLI tests: `https://cloud.yukibana.dev/` asks for the audience
  `https://cloud.yukibana.dev`; a `yukibana.json` naming a `projectId` still
  fans out under `--ci`; `--ci` with `--token` is refused.
* `action/action.yml`: `token` and `project` become optional; with neither,
  it runs `publish --ci` and says, if the OIDC variables are missing, to add
  `permissions: id-token: write`. Every input reaches the scripts through
  `env:` (`LABEL`, `FOLDER`, `DIRECTORY`, beside the `YUKIBANA_*` ones), and
  the scripts use `"$LABEL"`, `"$FOLDER"` and `"$DIRECTORY"`: no `${{ }}`
  expression of an input appears inside `run:`, only `github.action_path`.
  A comment says why: an input such as a tag name is data, and an
  expression is pasted into the script before bash parses it.
* The template's workflow (a patch for Luis, since we cannot push there):

  ```yaml
  on:
    push:
      tags: ['*']
  permissions:
    contents: read
    id-token: write
  ...
      - uses: Yukibana-Ed/Yukibana/action@main
        with:
          url: https://cloud.yukibana.dev
          label: ${{ github.ref_name }}
  ```

## Stage 5: documentation and operations

* `docs/cloud/deploy.md`: registering the GitHub App (one per environment).
  Its one permission is Repository metadata: read. It asks for nothing more
  because Administration and Repository creation are both sensitive
  permission sets that need an organisation owner's approval (GitHub
  changelog, 2026-10-13), and an App's permissions apply to every
  installation: with either, a teacher in a school organisation could not
  install the App even to pick an existing repository. Callback URL
  `<site>/auth/github/return`; "Request user authorization during
  installation" on; no webhook. The secrets `GITHUB_APP_CLIENT_ID`,
  `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_SLUG`, and `.dev.vars` for local
  use. `GITHUB_TEMPLATE` and the condition for setting it.
* `docs/cloud/architecture.md`, `docs/cloud/design.md` (the decision record
  above, including npm's lesson, who a link trusts, and that only tags
  publish), `docs/cloud/cli.md` (including that a re-run publishes again),
  the Action's header comment, and this page rewritten as the feature's
  documentation.

## Not doing (and why)

* **Webhooks and building in the cloud**: rejected before (`design.md`);
  builds stay on the forge's runners.
* **GitLab and Forgejo** now: adding a forge is a migration that adds an
  issuer column, an adapter in `oidc.ts` and a connect flow (and, for
  GitLab, a CI component).
* **Creating repositories from the App**: GitHub's "Use this template" page
  does it with the teacher's own rights, and the App keeps to metadata.
* **Per-link ref patterns** and **publishing from branches**: tags only,
  until a teacher needs otherwise; an additive migration can add a column.
* **Skipping a commit already published**: it silently dropped a release
  re-tagged on the same commit, and the token path has never done it.
* **Per-link directories**, **GitHub environments**, **workflow file
  binding**, **check runs**, **opening a PR to add the workflow**: each is
  useful to somebody and none is needed for the first teacher to publish.
* **Storing GitHub tokens server-side**: nothing needs them after the link.

## Review, 2026-11-18

Changed:

* The GitHub token cookie is sealed with the person's Supabase `sub`, the
  state cookie carries it too, and logout revokes the token and deletes both
  cookies; the token lives fifteen minutes and is deleted once a link is
  made. Its key comes from the client secret by HKDF, so `GITHUB_COOKIE_KEY`
  is gone.
* A link publishes only while the person who made it is an owner of the
  edition, checked in `app.publish_release_with_repository`.
* On the CI path the commit, ref and repository come from the verified token;
  a different form commit is refused.
* `identify` never reads cookies when a bearer is present, and every CI route
  verifies the token itself; the releases route has an explicit CI branch.
* The audience is the site's canonical origin on both sides, and a refusal
  names the one expected.
* Stage 1 grants what it revokes, as every migration here does.
* `app.ci_projects` tells a moved repository nothing but that it moved.
* The App installation flow exists: an install button with the same state
  cookie, a return route that ignores `installation_id`, and a sentence for
  a stateless arrival. Repository listing is bounded, with `owner/name` as
  the way to reach anything not listed, and a GitHub failure never takes
  the project page down.
* The App no longer creates repositories and asks only for metadata; the
  template is a link to GitHub's page, offered only once the template can
  publish with OIDC. The workflow snippet is always shown, collapsed.
* `ref_pattern`, `app.ref_matches`, `issuer`, `last_used_at`, the
  commit-based skip and `--force` are gone; releases record
  `published_from` instead of a `link_id` that relinking would leave
  dangling.
* The Action passes inputs to bash through `env:`.
* `publish --ci` is explicit, branches before a single project is resolved,
  and fans out even when `yukibana.json` names a project.
* The plan says plainly whom a link trusts: everyone who can push a tag or
  run a workflow in the repository.

Where two decisions conflicted, the simpler sound one was taken:

* The CLI asks for `client.origin` as the audience instead of first fetching
  `siteUrl` from `/api/auth/config`: one request fewer, and the refusal
  names the expected origin when they differ.
* `--ci` is explicit, rather than detected from `ACTIONS_ID_TOKEN_REQUEST_URL`
  with an empty `YUKIBANA_TOKEN` treated as absent: the Action passes it
  anyway, and a token workflow with an empty secret keeps saying that the
  token is missing.
* Tags only, rather than keeping the per-link pattern and only documenting
  who it trusts; the trust sentence was kept, about tags.
* `GITHUB_TEMPLATE` has no default, rather than defaulting to Luis's
  template, which has no OIDC workflow yet.
* The workflow snippet is always shown, collapsed, rather than while the
  link's `last_used_at` is null, since that column is gone.
* The install path is a field on the Connect action rather than an action of
  its own, and `setup_action` is ignored rather than turned into a message
  for `request`; the empty-picker sentence says an organisation owner may
  have to approve.

Turned down, and why:

* Requiring protected refs, making `*` stop at `/`, or refusing branch
  patterns: write access to the repository already means publishing, as
  with a token secret, and protection is not available on every plan.
* `--ignore-scripts` in the Action (the install compiles the CLI through its
  own `prepare`, and pnpm already refuses dependency scripts) and a separate
  publish job (complexity with no gain against our own code). Pinning the
  template's Action to a tag or SHA waits for the Action to have releases.
* `maxTokenAge`, `jti` and replay tracking: GitHub's tokens expire within
  minutes, and the CLI mints one per request.
* PKCE (the code exchange already uses the client secret, server-side),
  revoking the token after every link (one is deleted with its cookie
  instead), and a second App (twice the setup for two people).
* Repository creation: write and an API-side "create from template": still
  a sensitive permission needing an organisation owner's approval.
* A lazy, paged repository browser: one page per installation and a typed
  name are enough.
* GitHub Enterprise issuers and a configurable JWKS URL: the integration
  suite injects its keys into the server modules directly.
