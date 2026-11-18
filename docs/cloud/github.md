# Publishing from GitHub without a token

2026-11-18. A project can be linked to the GitHub repository its course
lives in, and that repository's own workflow then publishes releases to it
on every tag, proving where it runs with GitHub's OIDC token instead of a
secret. This page is what the feature does, how it is built, and why it is
shaped this way; it began as the plan, and the review that changed the plan
is kept at the end, with what the build changed after it. Paths are from the
repository's root. Setting up the GitHub App an environment needs is
[deploy.md](deploy.md), step 8.

## For a teacher

With a project token, a release from CI takes: make the project, make a
token on the project page, copy it, open the repository's settings, add the
secret, add the variable, make sure the workflow is there, push a tag. With a
link:

1. On the project page (Releases tab, **Publishing**: **Publish an
   existing project**, then **GitHub repository**), an owner presses
   **Connect GitHub** once. GitHub asks them to authorise the Yukibana Cloud
   GitHub App. The first time, or for a repository the App cannot see yet,
   they open **Repository not listed?** and press **Install the App or add
   repositories**, and choose the
   accounts or organisations, and the repositories, the App may see. In an
   organisation, an owner of the organisation may have to approve the
   installation.
2. They **pick an existing repository** from the ones the App can see and
   they administer or maintain, or type its `owner/name` (or paste its
   `https://github.com/owner/name` address). To start from a template, they
   choose **Create a new project** instead and press **Use template** beside one of the recommended
   templates (`cloud/web/src/lib/templates.ts`; for now
   `Yukibana-Ed/scala-project-template`), which opens GitHub's own "Use this
   template" page, then come back and pick the new repository like any
   other. A repository made from a recommended template already has the
   workflow below.
3. The repository needs the workflow the project page shows, collapsed,
   under "The workflow a linked repository needs", in
   `.github/workflows/publish.yml`:

   ```yaml
   name: Publish to Yukibana
   on:
     push:
       tags: ['*']
   permissions:
     contents: read
     id-token: write
   jobs:
     publish:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: Yukibana-Ed/Yukibana/action@main
           with:
             url: https://cloud.yukibana.dev
             label: ${{ github.ref_name }}
   ```

   It names no project: a release goes to every project linked to the
   repository, so linking one more project needs nothing in the repository.
   A repository that wants a say gives the Action `projects:`, the ids of
   the linked projects it publishes to, separated by commas (see "Many projects, one
   repository").
4. Pushing a tag (`git tag v1 && git push origin v1`) runs that workflow on
   GitHub's runners, which builds the archives with the CLI and publishes
   them to every project linked to the repository. The release list on the
   project page links the commit of a release published by link to that
   commit on GitHub, and the GitHub repository panel shows the last one.

**Change** picks another repository (the link is replaced); **Unlink** ends
it. Staff who are not owners see the link and cannot change it. Project
tokens and `yukibana publish` as a logged-in person work exactly as before,
and a project may have a link and tokens at once.

The job log names the repository, the ref and the commit, then every project
linked to the repository, with its id, published or skipped with the reason:

```
Yukibana-Ed/intro-exercises at refs/tags/v3 (4f0c2d9a1b7e) is linked to 3 projects
  publishes to ex1 "Hello, Scala" (Introduction to Programming, 2026 autumn, 01a0…5a01)
  skips ex1 "Hello, Scala" (Introduction to Programming, 2025 autumn, 01a0…5a02): The person who linked this repository is no longer an owner of this edition; an owner must link it again.
  publishes to ex1 "Hello, Scala" (Algorithms, 2026 autumn, 01a0…5a03)
```

A project that is skipped fails the job once the others have published, so
a green job never means fewer releases than the log suggests. With
`projects` given, a linked project it does not name is a warning, and is
sent nothing. The reasons a job reads, in the registry's own words:

| The job says | Because | What to do |
| --- | --- | --- |
| Only tags publish; this run is at refs/heads/main. | the run is not at a tag (a push to a branch, or a manual run started on one) | push a tag, or start the manual run on a tag |
| The person who linked this repository is no longer an owner of this edition; an owner must link it again. | the link lasts as long as its maker owns the edition | an owner presses Change and picks the same repository, or the repository stops naming the project |
| This repository moved to another owner; link it again on the project page. | the repository was transferred, so its owner id changed | an owner of the project links it again, which needs admin or maintain under the new owner |
| this repository is linked to no project, so there is nothing to publish to | no link, or it was removed | link it on the project page |
| … is linked to this repository, which does not name it (a warning) | the workflow gives `projects`, and somebody linked the repository to a project it does not list | nothing, if the project is not yours; otherwise add its id to `projects` |
| CI token refused: this token is for https://x; this registry expects https://y | the Action's `url` is not the registry's canonical address | use the address the project page's snippet shows |
| … add 'permissions: id-token: write' … | the workflow cannot ask GitHub for a token | add the `permissions` block above |

Who may publish is everyone who can push a tag, or run a workflow, in a
linked repository: they can publish to every project linked to it, exactly
as anyone with write access can read a token secret. Give write access to the
course repository only to people you would give the project's publishing
token, and protect tags with a ruleset (Settings, Rules) where your plan
allows it.

## Principles kept, and the one stretched

* **The cloud transforms nothing.** Builds happen on GitHub's runners, in the
  repository's own workflow, with the same CLI. The cloud receives two
  archives as before. No webhooks, no reading repositories, no creating them.
* **Authorisation lives in Postgres.** Who may link a repository to a
  project, and which repository may publish to which project, are a table,
  its policies and `security definer` functions, with pgTAP negatives.
* **Facts from outside are established by the Worker, at a boundary, and
  passed in.** This is the one that is stretched. Two facts come from
  GitHub: "this CI job runs in repository R of owner O, at ref F, on commit
  S" (a verified OIDC token, exactly as a verified Supabase JWT becomes
  `request.jwt.claims`) and "this person administers repository R" (asked of
  GitHub with their own token, at link time). The database decides
  everything from those facts; it cannot verify them itself, just as it
  cannot verify a JWT's signature. What the token proves is taken from the
  token, never from the request's body.
* **Least power per credential.** The OIDC token is short-lived, minted per
  request by GitHub, and never stored. `yukibana_publisher` still has no
  table grant. The App asks for nothing but repository metadata. The GitHub
  user token is held for fifteen minutes at most, encrypted and bound to the
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
  the job is told so in words ("This repository moved to another owner; link
  it again on the project page."), not just "no projects". It is told
  nothing else: the new owner has no relation to the course, and learns no
  project's id or title, nor how many projects there were.
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
an owner of it, the link stops publishing ("The person who linked this
repository is no longer an owner of this edition; an owner must link it
again.") instead of carrying on in the name of somebody who is not a member.
Releases by link record that person as `uploaded_by`.

## Many projects, one repository

Several projects may link the same repository (the same exercise in two
editions, for instance). A project links at most one repository, so a
project's releases have one source. When a job runs, the CLI asks the cloud
which projects this repository publishes to, and publishes to each of them:
one build per project (the starter carries the project's id and a fresh
release id), one request each. Releases are independent; a failure for one
project does not stop the others, and the job fails at the end naming every
failure. A re-run publishes again, as a re-run with a token does: a release
of identical content costs a student at most an update that changes no file.

Because of that fan-out, **linking requires proof of control**. Otherwise a
stranger could link somebody's private course repository to a project of
their own, and that repository's CI would push its hidden tests into the
stranger's project. Linking therefore asks GitHub, with the teacher's own
token, for the repository, and requires `permissions.admin` or
`permissions.maintain`.

That proof is asked once, when the link is made, and a link outlives it:
it survives its maker losing access to the repository, and only an owner
of the project can remove it, never the repository's administrators. So
an assistant briefly given admin on the course repository could link it to
a project of their own and, removed from the repository, keep receiving
every teacher archive it built, hidden tests and all. By default that risk
is accepted, for the sake of the default the feature exists for: a
repository made from a template publishes to every project linked to it,
with nothing to configure, and linking it to one more project needs nothing
in the repository. Two things bound it. The job log lists every linked
project, with its edition and id, on every run, so the repository's
administrators see where its releases go. And a repository that wants a say
gives the Action's `projects` input (`--projects`): a release then goes
only where the link and the repository agree, a linked project it does not
name is warned about and sent nothing, and a dead link that fails every tag
(its maker no longer an owner, and no owner left to relink or unlink) is
ended by no longer naming it. (The build's final review had made
`projects` required; that was reverted before merge, since it brought back
per-repository configuration, the cost this feature removes.) On a
public repository the job log is public, and so are the titles of the
projects and editions it names.

## How it is built

### The database

`cloud/db/supabase/migrations/20261118090000_repository_links.sql`, tested by
`cloud/db/supabase/tests/repository_links.test.sql`.

* `public.repository_link`: one row per linked project (`project_id` is
  unique), with `repository_id` and `owner_id` (digits only),
  `repository` (`owner/name`, display only), `linked_by` and `linked_at`.
  Staff of the project's edition read it (`app.may_edit_projects`); students
  do not. `authenticated` has `select` and nothing else; nobody has an
  insert, update or delete grant. The issuer is not stored, because the
  Worker accepts only GitHub Actions' (below); a second forge adds an
  `issuer` column with GitHub's as its default, and new overloads of the
  functions, in an additive migration.
* `project_release.published_from`: the repository a release came from, from
  the verified token's claim; null for a release not made by a link. A name
  and not a link id, because links are replaced and deleted and the history
  must not lose its source.
* `app.link_repository(project, repository_id, owner_id, repository)`: owners
  only (`app.is_owner`), replaces the project's link if there is one (a new
  link id each time), and leaves an audit row naming the link it replaced.
  `app.unlink_repository(project)`: owners only, audit row, P0002 when there
  is nothing to unlink.
* `app.ci_projects(repository_id, owner_id, ref)`, for `yukibana_publisher`:
  one row per link of that repository whose owner matches, ordered by
  edition then slug, with the project's id, slug and title, the edition's
  title and label, and three verdicts: `owner_matches`, `ref_matches` (a
  tag) and `owner_current` (the linking person still owns the edition).
  Links whose owner does not match come back as at most one row, with
  `owner_matches` false and everything else null.
* `app.publish_release_with_repository(…)`, for `yukibana_publisher`: refuses
  with 42501 and a sentence unless the project is linked to that repository
  id, with that owner id, the ref is a tag, and the linking person still has
  an `enrollment` row with role `owner` in the edition (asked directly of
  `public.enrollment` through `app.link_owner_current`, since the publisher
  has no `auth.uid()`). It records the release with `uploaded_by` the linking
  person and `published_from` the repository, and an audit row with the
  repository, its id, the ref, the commit and the link.

### The Worker, for CI

* `cloud/web/src/lib/server/oidc.ts` verifies the bearer a job sends:
  issuer `https://token.actions.githubusercontent.com` (GitHub Enterprise's
  custom issuers are refused like any other), the audience, RS256, against
  GitHub's published keys; then `ciIdentityOf` reads the repository, its
  id, the owner id, the ref, the commit and the event, and refuses events
  other than `push` and `workflow_dispatch`. A refusal is a sentence; GitHub's
  keys being unreachable is a 503 that says so, not a refused token.
* **The audience is the site's canonical origin**, `siteOrigin(SITE_URL,
  request)`: the address the IDE login uses, `SITE_URL` in production and
  in preview versions, the request's origin only locally. The CLI asks GitHub
  for the origin of the registry URL it was given, so a trailing slash or a
  path makes no difference, but another address of the same Worker (the
  workers.dev one) is refused with both addresses named. The project page's
  snippet shows the canonical origin for that reason.
* `cloud/web/src/lib/server/ci.ts` asks `app.ci_projects` and turns its
  verdicts into the sentences above, the same ones the database uses when
  it refuses (a unit test reads them out of the migration).
* `GET /api/ci/projects` (a CI token only) answers
  `{ repository, ref, sha, moved, projects: [{ id, slug, title, edition, refused }] }`.
* `POST /api/projects/{id}/releases` checks for a CI token before anything
  else (a JWT from any issuer but Supabase Auth, so that another issuer is
  told which one is accepted). For one, it asks `app.ci_projects` about the
  project before a byte is stored, and records with
  `app.publish_release_with_repository`; for a moved repository, whose old
  links `app.ci_projects` does not name, that function alone decides, and its
  refusal deletes both objects. The
  commit, ref, repository and ids come from the token; a form `commit` that
  differs from the token's is a 400 and stores nothing. The label stays a
  form value: it is display text, not provenance.
* `session.ts`: `identify` treats a bearer that is a project token, or a JWT
  whose issuer is not a Supabase Auth one, as nobody, without asking Auth;
  and whenever a bearer is present it never reads cookies, so a fake
  GitHub-looking bearer sent with a teacher's cookies is nobody, not the
  teacher. `forgery` lets bearer requests through on exactly that promise.

### The Worker, for the teacher

* Configuration (`env.ts`): `GITHUB_APP_CLIENT_ID`,
  `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_SLUG`, all three or none. None
  turns linking off: the GitHub routes and actions answer 404 and the
  project page says nothing about GitHub (publishing by link keeps working
  for links that exist). Some but not all is a configuration error naming
  the missing ones, reported, with linking off and the rest of the site
  working. The client id and the slug are `vars` in `wrangler.jsonc`; the
  client secret is a Worker secret. The recommended templates are a list
  in code, `cloud/web/src/lib/templates.ts`.
* No App private key: everything is done with the person's own
  user-to-server token, which can do only what both the App and the person
  may, and the App may only read metadata.
* `cloud/web/src/lib/server/github.ts`: the `GitHub` interface
  (`exchangeCode`, `installations`, `installationRepositories`,
  `repositoryById`, `repositoryByName`, `revokeToken`) and its one `fetch`
  implementation, every answer narrowed from `unknown`. A typed name is
  checked to be `owner/name` before it is sent.
* `cloud/web/src/lib/server/github-cookie.ts`: AES-GCM sealing under a key
  derived with HKDF-SHA-256 from `GITHUB_APP_CLIENT_SECRET` (info
  `yukibana-github-cookie`, empty salt), so there is no secret of its own to
  provision, and rotating the client secret only invalidates fifteen minutes
  of cookies. `__Host-yukibana-github` holds `{ token, sub, expires }` for
  fifteen minutes; `__Host-yukibana-github-state` holds `{ state, sub,
  edition, project, expires }` for ten. The cookie's name is sealed in, so
  one is never read as the other, and a cookie sealed for another person is
  not used. Without that binding, on a shared machine, a second teacher
  signing in after the first could link the first teacher's private
  repository to a project of their own with the first teacher's proof of
  control, and the first teacher's next tag would send the hidden tests
  there.
* `cloud/web/src/lib/server/github-link.ts` holds the decisions, and the
  routes call it:
  * `POST ?/connectGithub` on the project page (a same-origin form, as every
    cookie write) sets the state cookie and redirects to GitHub's authorize
    page; with `install=1` (**Install the App or add repositories**) to the
    App's installation page instead, which, with "Request user authorization
    during installation" on, comes back to the same route with a code.
    Connect itself stays on the authorize page, because for somebody who
    installed the App already, the installation page is a settings screen
    that may not come back.
  * `GET /auth/github/return?code&state` is refused, before GitHub is asked
    and without touching a cookie, unless `state` equals the state cookie
    and the cookie was sealed for the person signed in. A return with no
    state cookie at all (somebody installed the App from github.com) goes to
    `/auth/github/installed`, which says to go back and press Connect.
    Otherwise it exchanges the code, sets the token cookie, deletes the
    state cookie and goes back to the Repository section. `installation_id`
    and `setup_action` are ignored: the installations are listed again with
    the token.
  * The page's `load` lists repositories only for an owner with a token
    cookie, when the project has no link or the address has `?relink`, and
    only after its database transaction has closed: one page of 100
    repositories from each of at most ten installations, keeping those with
    admin or maintain, so its requests stay well under the Worker's
    subrequest limit. A GitHub failure or rate limit is reported and shown as
    a sentence; it never fails the page.
    The list is the person's own, wherever the App is installed: asked with
    a user's token, GitHub lists only the repositories that user has
    explicit access to, each with that user's permissions ("The access the
    user has to each repository is included in the hash under the
    permissions key"), so an App installed on a whole organisation shows a
    member nothing they could not open themselves, and only what they
    administer or maintain is kept. Staff's access on GitHub need not match
    their role in the edition, either way: an owner without access, not yet
    or not any more, sees an empty list and a refusal that says it may be
    their access; an assistant who administers the repository sees it and
    the database refuses the link. Unlinking needs no GitHub access, so an
    owner who lost theirs can still end a link. A link already made keeps
    publishing while its maker owns the edition, whatever their access on
    GitHub since (see "Many projects, one repository").
  * `POST ?/linkRepository` asks GitHub for the repository, by id or by name,
    with the person's token, requires admin or maintain, then calls
    `app.link_repository` with the ids GitHub returned, and deletes the token
    cookie: nothing needs it any more. `POST ?/unlinkRepository` unlinks.
  * `/auth/logout` revokes the GitHub token, if the cookie holds one for
    this person (best effort, reported on failure), and deletes both cookies.

### The CLI, the client and the Action

* `YukibanaClient.ciProjects()` asks `GET /api/ci/projects`;
  `publishRelease` takes the OIDC token as its bearer like any other.
* `yukibana publish [dir] --ci [--projects <ids>]` (`packages/cli/src/commands/release.ts`, with
  its decisions in `src/lib/publish.ts`): CI mode is only ever explicit, and
  `--ci` with `--token` or `--project` is refused, as is `--projects`
  without `--ci`. It ignores, with a
  warning, `YUKIBANA_TOKEN`, `YUKIBANA_PROJECT` and the `projectId` in
  `yukibana.json`: a repository made from a template may well name the
  template's project. It asks GitHub for a token (`src/oidc.ts`) with the
  registry's origin as the audience, a fresh one for every request and never
  printed, prints the plan above, then builds and publishes once per
  project it lists (or, with `--projects`, once per one of them it names),
  each with its own release id and the token's commit.
* `action/action.yml`: with neither `token` nor `project`, it runs
  `publish --ci`, with `--projects` when its `projects` input is given, and says first, as an error annotation, when the job has no
  `id-token: write`. With either, it runs the token command as before. Every
  input reaches bash through `env:`; the comment above the step says why.

## Tests

* pgTAP (`repository_links.test.sql`), negatives first: a student, an
  assistant, an owner of another edition and anyone signed out cannot link,
  the first three cannot unlink; a student reads no link; nobody writes the
  table directly; the publisher has no `select` on it and `authenticated`
  cannot publish by repository; a wrong owner id, a branch ref, an unlinked
  project and a project linked to another repository are refused and store
  nothing; so is a link whose maker was demoted, or removed; a moved
  repository's `ci_projects` row carries no project. Positives prove the
  negatives are not vacuous.
* Unit: the token's claims as a table and tokens signed with a local key
  (`cloud/web/tests/oidc.test.ts`), the sentences against the migration
  (`ci.test.ts`), GitHub's answers, the picker and every case of the return
  route against a stubbed GitHub (`github.test.ts`), the cookies
  (`github-cookie.test.ts`), the configuration (`env.test.ts`), and in the
  CLI the two decisions as tables, the token request and whole `publish --ci`
  runs against a stubbed GitHub and registry.
* Integration, against the real stack, with tokens signed by a locally
  generated key and a stubbed GitHub, so nothing contacts GitHub:
  `ci.test.ts` (publishing to two projects, and every refusal storing no
  object and no row, over HTTP too) and `github-link.test.ts` (the database
  refusing an assistant or a student who administers the repository).
  `sibling.test.ts` runs the app with a GitHub App that does not exist and
  checks that a sibling subdomain's requests to the new routes change
  nothing, set or spend no GitHub cookie, and never reach GitHub.

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

The plan was reviewed before it was built. Changed:

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
* The migration grants what it revokes, as every migration here does.
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
* No template was configured by default, since Luis's template had no OIDC
  workflow; after the build, `GITHUB_TEMPLATE` gave way to a list of
  recommended templates in code, starting with
  `Yukibana-Ed/scala-project-template`, made from Luis's with the OIDC
  workflow.
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

## What the build changed from the reviewed plan

Each was decided while building, for the reason given:

* **Owners are checked with `app.is_owner`, not `app.role_in(edition) =
  'owner'`.** `role_in` is null for somebody not enrolled, and an `if` on
  null does not raise, so a stranger would have passed: the hole migration
  20261008120000 closed once already.
* **A moved repository is one row, not one per link**, in
  `app.ci_projects` and as a top-level `moved` sentence in
  `GET /api/ci/projects`: the new owner learns that the repository moved,
  not how many projects it used to publish to.
* **The edition's label travels with its title**, because editions of one
  course share a title and a job log has to tell them apart.
* **Unlinking a project with no link is P0002**, as revoking an invite that
  is gone is.
* **The Worker refuses a wrong issuer, audience, algorithm or an expired
  token before it fetches GitHub's keys**, from the unverified token, and
  jose checks all of it again on the verified one: clearer sentences, and
  the HTTP tests reach the CI refusal without the app contacting GitHub.
* **A half-configured App is an error**, not "off": a partial setup is
  almost certainly a mistake, and nothing fails silently.
* **The integration suite's app ignores a local `.dev.vars`**
  (`YUKIBANA_VARS_FROM_PROCESS`), which wrangler otherwise prefers to the
  process environment; the GitHub App the suite sets was silently off
  locally and on in CI.
* **A return with no connection in flight redirects to
  `/auth/github/installed`**; the project page's `load` ignores a GitHub
  cookie sealed for somebody else rather than deleting it (a load has no
  side effects; `?/linkRepository` deletes it).
* **A skipped project fails the job**, after the others have published,
  rather than only "no linked projects" failing it. A moved repository fails
  the job only when it has no current link: old links belong to projects
  its new owner has no say over.
* **The CLI warns, rather than fails, when the checkout's HEAD is not the
  token's commit**; the release records the token's commit either way.
* **The page's snippet names the canonical origin**, not the address the
  page was opened at, since the audience is the canonical origin.

## Review of the build, 2026-11-18

* **A repository may name its projects** (`projects`, `--projects`), and a
  linked project it does not name is then sent nothing; without it, a
  release goes to every linked project. The final review made it required,
  since a link outlives its maker's access to the repository, which cannot
  remove it; before merging, it was made optional again, because requiring
  it brought back per-repository configuration (see "Many projects, one
  repository"). It also lets a repository stop a dead link from failing
  every tag.
* **A key set GitHub cannot serve is a 503, reported**, whatever jose calls
  the failure. Only its timeout had been; a 502 from GitHub's key set was
  answered "401 CI token refused: it could not be verified" and reported
  nothing.
* **The Worker's pre-check leaves a moved repository to the database.**
  `app.ci_projects` cannot say which project a moved link was for, and the
  pre-check answered "moved" for a project that was never linked; now the
  database answers, after the upload, whose objects its refusal deletes.
* **Connect GitHub pressed while changing a link comes back to the
  picker** (the state cookie carries `relink`); it came back to the old link.
* **Any JWT not from Supabase Auth takes the CI path**, so a GitHub
  Enterprise job is told which issuer is accepted rather than to log in.
