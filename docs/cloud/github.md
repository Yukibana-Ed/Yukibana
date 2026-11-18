# Publishing from GitHub without a token: the plan

2026-11-18. Status: plan, before review. This page becomes the feature's
documentation once it is built; until then it is the plan the
implementation follows, stage by stage. Paths are from the repository's
root.

## What changes for a teacher

Today a release from CI takes: make the project, make a token on the
project page, copy it, open the repository's settings, add the secret, add
the variable, make sure the workflow is there, push a tag.

After this:

1. On the project page, an owner presses **Connect GitHub** once. GitHub asks
   them to authorise the Yukibana Cloud GitHub App (and, the first time, to
   install it on the accounts or organisations whose repositories they want
   to use).
2. They either **pick an existing repository** from the ones the App can see,
   or **create one from a template** (Luis's Scala template by default).
3. That is all. Pushing a tag matching the link's ref pattern (default
   `refs/tags/v*`) runs the repository's own workflow on GitHub's runners,
   which builds the archives with the CLI and publishes them, proving where
   it runs with GitHub's OIDC token instead of a secret.

Project tokens and `yukibana publish` as a logged-in person keep working
exactly as they do.

## Principles kept, and the one stretched

* **The cloud transforms nothing.** Builds happen on GitHub's runners, in the
  repository's own workflow, with the same CLI. The cloud receives two
  archives as today. No webhooks, no reading repositories.
* **Authorisation lives in Postgres.** Who may link a repository to a
  project, and which repository may publish to which project, are a table,
  its policies and `security definer` functions, with pgTAP negatives.
* **Facts from outside are established by the Worker, at a boundary, and
  passed in.** Two new facts come from GitHub: "this CI job runs in
  repository R of owner O, at ref F" (a verified OIDC token, exactly as a
  verified Supabase JWT becomes `request.jwt.claims`) and "this person
  administers repository R" (asked of GitHub with their own token, at link
  time). The database decides everything from those facts; it cannot verify
  them itself, just as it cannot verify a JWT's signature today.
* **Least power per credential.** The OIDC token is short-lived, minted per
  job by GitHub, and never stored. `yukibana_publisher` still has no table
  grant. The GitHub user token is held for an hour, encrypted, in a
  `__Host-` cookie, and never stored server-side.

## The identity a link binds to (and what npm got wrong)

A link binds a project to `(issuer, repository_id, owner_id)`: GitHub's
numeric, immutable ids, taken from the repository picker at the moment of
linking. Names are for display only.

* A **rename** keeps the link (the id does not change); the displayed name is
  refreshed from the token's `repository` claim on the next publish.
* A **transfer** to another owner breaks it: `owner_id` no longer matches, and
  the job is told so in words ("this repository moved to another owner;
  link it again on the project page"), not just "no projects".
* A **deleted and recreated** repository of the same name has a new id and
  publishes nothing.

npm's trusted publishing bound to owner/repo names until a first publish,
which left about 1,500 packages open to whoever re-registered a freed name
("SlugFest", disclosed 2026-10-13). PyPI resolves and stores the owner's id
when a publisher is configured. We bind ids immediately, because the picker
already has them, so there is no window at all.

Only `push` and `workflow_dispatch` events may publish (an allow list: npm
learned with `issue_comment` that a deny list misses one), and only from a
ref matching the link's pattern.

## Many projects, one repository

Several projects may link the same repository (the same exercise in two
editions, for instance). A project links at most one repository, so a
project's releases have one source. When a job runs, the CLI asks the cloud
which projects this repository publishes to at this ref, and publishes to
each of them: one build per project (the starter carries the project's id
and a fresh release id), one request each. Releases are independent; a
failure for one project does not stop the others, and the job fails at the
end naming every failure.

Because of that fan-out, **linking requires proof of control**. Otherwise a
stranger could link somebody's private course repository to a project of
their own, and that repository's CI would push its hidden tests into the
stranger's project. Linking therefore asks GitHub, with the teacher's own
token, for the repository by id, and requires `permissions.admin` or
`permissions.maintain`. The job log lists every project it publishes to, so
a repository's administrators can see the links.

Re-running a job does not duplicate releases: the cloud tells the CLI each
project's newest release's commit, and a project already at this commit is
skipped unless `--force`.

## Stage 1: the database

One migration, `cloud/db/supabase/migrations/<timestamp>_repository_links.sql`,
and `cloud/db/supabase/tests/repository_links.test.sql`.

```sql
create table public.repository_link (
  link_id       uuid primary key default app.uuidv7(),
  project_id    uuid not null unique references public.project (project_id) on delete cascade,
  issuer        text not null check (issuer ~ '^https://'),
  repository_id text not null check (repository_id ~ '^[0-9]+$'),
  owner_id      text not null check (owner_id ~ '^[0-9]+$'),
  repository    text not null,           -- "owner/name", display only
  ref_pattern   text not null default 'refs/tags/v*' check (ref_pattern ~ '^refs/(heads|tags)/'),
  linked_by     uuid not null references public.app_user (user_id) on delete restrict,
  linked_at     timestamptz not null default now(),
  last_used_at  timestamptz
);
create index repository_link_repository on public.repository_link (issuer, repository_id);
alter table public.project_release add column link_id uuid;  -- like token_id: no FK, history outlives the link
```

* RLS on; `select` for staff of the project's edition (`app.may_edit_projects`),
  nothing for students; no insert/update/delete grant for anyone.
* `app.ref_matches(pattern text, ref text) returns boolean`: `*` matches any
  run of characters (including `/`), everything else is literal. Immutable,
  pure, tested as a table.
* `app.link_repository(project, issuer, repository_id, owner_id, repository, ref_pattern) returns uuid`:
  owners only (`app.role_in(edition) = 'owner'`, as for tokens: a link is a
  publishing credential); replaces the project's link if there is one;
  audit row.
* `app.unlink_repository(project)`: owners only; audit row.
* `app.ci_projects(issuer, repository_id, owner_id, ref)`, for
  `yukibana_publisher`: every link with that issuer and repository id, with
  `project_id`, the project's slug and title, the edition's title,
  `owner_matches`, `ref_matches`, and the newest release's `commit_sha`. The
  Worker turns the two booleans into sentences.
* `app.publish_release_with_repository(issuer, repository_id, owner_id, ref, repository, project, release, label, commit_sha, keys and sizes and digests…) returns uuid`,
  for `yukibana_publisher`: refuses (42501, in words) unless a link for
  `(project, issuer, repository_id)` exists with a matching owner and ref;
  inserts the release with `uploaded_by = linked_by` and `link_id`; refreshes
  `repository` and `last_used_at`; audit row with the repository and ref.
* Execute on these revoked from `public, anon, authenticated` (the two CI
  functions) or from `public, anon` (link/unlink).

pgTAP negatives: a student, an assistant, and an owner of another edition
cannot link or unlink; a student reads no link; nobody can insert into the
table directly; the publisher reads no table; a wrong owner id, a ref outside
the pattern, an unlinked project, and a project linked to another repository
are each refused; a repository linked to A cannot publish to B; a release by
link records `link_id` and `uploaded_by`. Plus the positives that prove the
negatives are not vacuous.

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
    own tokens with a local key set.
  * `isCiToken(bearer)`: an unverified peek at `iss`, only to route.
* The audience is the site's canonical URL (`SITE_URL`, else the request's
  origin).
* `hooks.server.ts` / `session.ts`: a bearer that is a project token or a CI
  token is not handed to Supabase (`identify`), so it is neither refused nor
  reported as a bad session.
* `Publisher` (`releases.ts`) gains `{ kind: 'ci'; identity: CiIdentity }`.
  `publishRelease` checks the project is among `app.ci_projects` (refusing
  with the reason) before storing a byte, and records with
  `app.publish_release_with_repository`.
* `GET /api/ci/projects` (CI bearer only): `{ repository, ref, sha, projects: [{ id, slug, title, edition, publishedCommit, refused: string | null }] }`.
  A project whose owner or ref does not match is listed with the reason, so
  the job log can say why it was skipped.
* Shapes in `cloud/web/src/lib/api.ts`; the client decodes them in
  `packages/client/src/lib/wire.ts`.
* Integration tests (`cloud/web/tests/integration/ci.test.ts`): a token
  signed by a local key, publishing to two linked projects; a wrong
  audience, a wrong issuer, an expired token, a `pull_request` event, a
  wrong ref and a moved owner are each refused and store nothing.

## Stage 3: the Worker, for the teacher

* Config (`env.ts`), all optional; the feature is off (and the page says
  nothing about GitHub) unless all are set: `GITHUB_APP_CLIENT_ID`,
  `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `GITHUB_COOKIE_KEY` (32
  random bytes, base64, for the token cookie), and
  `GITHUB_TEMPLATE` (default `LordBaryhobal/yukibana-template-scala`).
* No App private key is needed: everything is done with the person's own
  user-to-server token, which can do only what both the App and the person
  may.
* `cloud/web/src/lib/server/github.ts`: a small typed client over `fetch`
  (`exchangeCode`, `installations`, `installationRepositories`,
  `repositoryById`, `generateFromTemplate`), an interface so tests can stub
  it, every response narrowed from `unknown` at the boundary.
* `cloud/web/src/lib/server/github-cookie.ts`: AES-GCM seal/open of
  `{ token, expires }` into `__Host-yukibana-github` (Secure, HttpOnly,
  SameSite Lax, path `/`, an hour).
* Routes, following the sibling-subdomain rules:
  * `POST ?/connectGithub` on the project page (a same-origin form, as every
    cookie write): sets `__Host-yukibana-github-state` (random, ten minutes,
    with the project id) and redirects to GitHub's authorize URL.
  * `GET /auth/github/return?code&state`: refused before anything else unless
    `state` equals the state cookie; then exchanges the code, sets the token
    cookie, clears the state cookie, and redirects to the project page. Like
    `/auth/callback`, its one side effect is a cookie only this host can
    set. Covered by `sibling.test.ts` like every route.
  * The project page `load` (owners only) reads the token cookie, if any,
    and lists installations and their repositories: a read.
  * `POST ?/linkRepository` (`repository_id`, `ref_pattern`): asks GitHub for
    the repository by id with the person's token, requires admin or
    maintain, then calls `app.link_repository` with the ids GitHub returned.
  * `POST ?/createRepository` (`owner`, `name`, `private`, `template`):
    generates from the template with the person's token, then links the
    result the same way.
  * `POST ?/unlinkRepository`.
* The page: a "Repository" section for owners showing the link (repository,
  ref pattern, who linked it, last publish) with Unlink; otherwise Connect /
  pick / create. Staff who are not owners see the link read-only. The
  release list says "from owner/repo" for a release by link, as it says
  "by token" today. The workflow snippet to paste is shown for a repository
  that did not come from the template.
* Unit tests: cookie sealing (tampered, expired, wrong key), the GitHub
  client's narrowing against recorded responses, the permission check.

## Stage 4: the CLI, the client and the Action

* `packages/client`: `YukibanaClient` gains `ciProjects()`, and accepts the
  OIDC token as its bearer like any other.
* `yukibana publish --ci` (`packages/cli`), also chosen when
  `ACTIONS_ID_TOKEN_REQUEST_URL` is set and neither `--token`,
  `YUKIBANA_TOKEN` nor a login is given: requests an OIDC token for the
  registry's URL as audience (`ACTIONS_ID_TOKEN_REQUEST_URL&audience=…` with
  `ACTIONS_ID_TOKEN_REQUEST_TOKEN`), fresh for each request; asks
  `/api/ci/projects`; prints every project and why any is skipped; builds
  and publishes to each remaining one; `--force` publishes even when the
  commit is already published; exits non-zero naming every failure. No
  linked projects is a failure with a sentence pointing at the project
  page.
* What to publish is a pure function in `packages/cli/src/lib` (from the
  answer, the commit and `--force` to a plan), tested as a table.
* `action/action.yml`: `token` and `project` become optional; with neither,
  it runs `publish --ci` and says, if the OIDC variables are missing, to add
  `permissions: id-token: write`.
* The template's workflow (a patch for Luis, since we cannot push there):

  ```yaml
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

* `docs/cloud/deploy.md`: registering the GitHub App (one per environment):
  permissions Metadata read and Administration write (for templates);
  callback URL `<site>/auth/github/return`; "Request user authorization
  during installation" on; no webhook. The secrets, and `.dev.vars` for local
  use.
* `docs/cloud/architecture.md`, `docs/cloud/design.md` (the decision record
  above, including npm's lesson), `docs/cloud/cli.md`, the Action's header
  comment, and this page rewritten as the feature's documentation.

## Not doing (and why)

* **Webhooks and building in the cloud**: rejected before (`design.md`);
  builds stay on the forge's runners.
* **GitLab and Forgejo** now: the schema is forge-neutral (`issuer`), and
  both have CI OIDC tokens with the same shape of claims, so each is later an
  adapter in `oidc.ts`, a connect flow and (for GitLab) a CI component.
* **Per-link directories**, **GitHub environments**, **workflow file
  binding**, **check runs**, **opening a PR to add the workflow**: each is
  useful to somebody and none is needed for the first teacher to publish.
* **Storing GitHub tokens server-side**: nothing needs them after the link.
