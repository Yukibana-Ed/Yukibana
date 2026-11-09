# Deploying Yukibana Cloud

> Until the cutover, the cloud still deploys from the yukibana-cloud repository (Workers Builds and its Database
> workflow). This page describes the pipeline of this repository, which takes over from then on. The cutover is done
> in this order, so that only one repository ever deploys:
>
> 1. Freeze yukibana-cloud's cloud parts: no merges outside `light/`.
> 2. Disconnect its Worker from Workers Builds (the Worker's Settings, Builds, Disconnect), and disable its
>    `database.yml`, `drift.yml`, `ci.yml` and `ci-devcontainer.yml`
>    (`gh workflow disable <file> -R tothambrus11/yukibana-cloud`). Leave its `CLOUDFLARE_*` secrets: they deploy
>    Light.
> 3. Create this repository's `production` and `preview` environments with their secrets (step 5). Drift uses
>    `production` too.
> 4. In `main`'s branch protection (or ruleset), remove the old required checks, whose jobs no longer exist (the IDE's
>    build.yml), make `ci-ok` the one required check, and turn on "Require branches to be up to date before merging".
>    There is no merge queue: being up to date is what makes a merge land the tree its pull request's run tested, which
>    is what Deploy cloud checks. The pull request of step 5 is merged with a **merge commit**, never squashed or
>    rebased: it starts with the merge commit that imports the old repositories' histories, and a squash or a rebase
>    flattens them away.
> 5. Merge the pull request that adds these workflows, as a merge commit. It changes
>    `deploy-cloud.yml`, so once CI has passed on the commit it puts on `main`, that is the first deploy from here; if
>    it ran before step 3, it fails at Credentials: re-run it ("Re-run failed jobs") once the secrets are in.

One Supabase project (Postgres and Auth), one Cloudflare Worker, one R2
bucket. Everything below fits the free tier of both, with one caveat: R2 asks
for a payment method before it will turn on, even though the 10 GB allowance
is genuinely free.

This page has two halves. The first is how a change reaches production once
an environment exists; the second, from step 1, is setting one up.
`architecture.md` says what the pieces are and how they connect. Commands run
from the repository root.

## The pipeline

After the first setup, deploying is merging a pull request into `main`, up to
date with it. Five workflows listen to the repository:

```
 pull request ──────────────▶ CI (ci.yml)
                                plan → the affected packages' checks, the cloud stack, …
                                → ci-ok, the one required check
                                and, for a pull request that affects cloud/web, a preview build
 CI of a pull request ──────▶ Preview (preview.yml), once a maintainer approves
                                wrangler versions upload → a preview URL on the pull request
 push to main ──────────────▶ Deploy cloud (deploy-cloud.yml), when the cloud is affected,
                                once its pull request's passing CI run tested that tree
                                placeholders → secrets → migration list → db push
                                → cloud/db/ops/bootstrap.sql → config diff → config push
                                → build → wrangler deploy
 push to main ──────────────▶ Warm caches (warm-caches.yml): the caches pull requests restore
 03:17 UTC daily ───────────▶ Drift (drift.yml)
                                production vs migrations, Realtime policies, event triggers
```

| | Triggered by | Does | Needs |
| --- | --- | --- | --- |
| **CI** | pull requests (not pushes to `main`: a pull request merges only up to date with `main`, so the merge lands the tree its run tested) | lint, typecheck, unit tests and builds of the packages the change affects (pnpm's package graph); `yukibana check` over the fixture; when `cloud/web`, `cloud/db` or `cloud/dev` is affected, the real stack on the runner: every migration from empty, pgTAP, the Realtime policy and event trigger checks, the integration suite; squawk is `cloud/db`'s lint; the devcontainer build when `cloud/dev` changed, or what its install reads (`package.json`, the lockfile, `pnpm-workspace.yaml`, the manifests of `cloud/db`, `cloud/web`, `packages/cli`, `packages/client` and `packages/fixtures`), or `cloud/db/supabase/config.toml`, which its start runs | nothing secret |
| **Preview** | CI of a pull request from a branch of this repository that affects `cloud/web`, with or without a change to `cloud/db` | uploads the build CI made as a preview version (`wrangler versions upload --preview-alias pr-<n>`), and comments its URL | a maintainer's approval of the `preview` environment, and its Cloudflare secrets |
| **Deploy cloud** | a push to `main` of Yukibana-Ed/Yukibana, when the commit's tree is its merged pull request head's and that head's newest CI run passed (it refuses any other commit: one merged out of date, or pushed by a bypass), and the changes since the last successful run affect `@yukibana/cloud-web` or `@yukibana/cloud-db` (or a package they use, such as `@yukibana/client`, whose `yukibana.schema.json` the Worker serves), or change the lockfile, `package.json`, `pnpm-workspace.yaml`, `deploy-cloud.yml` or `.github/scripts/production-config.mts`. Never by hand: it has no "Run workflow" button, so production only ever gets what CI tested. A run's title, `Deploy <commit>`, names the commit it deploys | refuses a commit older than the last deploy's, and one whose pull request's run did not pass the cloud stack (that run compares with its base, this with the last deploy, so a change from a failed deploy could otherwise go out with a later merge that skipped the stack), checks no placeholder is left, checks every secret is set, lists then applies pending migrations, runs `cloud/db/ops/bootstrap.sql`, prints the settings diff, pushes `cloud/db/supabase/config.toml`'s production block, then builds and deploys the Worker. One run at a time (`concurrency: deploy-cloud`). | the `production` environment's secrets, step 5 |
| **Drift** | nightly, or by hand | `supabase db diff` of production against the migrations for `public` and `app`, `cloud/db/ops/realtime-policies.sql` and `cloud/db/ops/event-triggers.sql` | `SUPABASE_DB_URL` only |

Two consequences are worth knowing before the first change:

* **The database goes first, then the Worker, in one run.** What keeps the
  site up between the two steps is the rule that migrations only ever add:
  the Worker still running is old code against a new schema, which is fine.
  The other direction is not, which is why removing something takes two
  deploys (below).
* **A preview is production with other code.** A preview URL
  (`pr-<n>-yukibana-cloud.<subdomain>.workers.dev`, enabled by
  `preview_urls` in `cloud/web/wrangler.jsonc` from the first deploy that has
  it) runs the pull request's Worker with production's bindings and secrets:
  the same database, the same bucket, the same accounts, which is why a
  maintainer approves each one. It does not have
  the pull request's migrations, which reach production only once merged,
  so a page that needs them fails there; previews are for looking at pages.
  Log in with an email code, and only to look: GitHub's login ends on
  `cloud.yukibana.dev` instead, because Auth returns only to addresses in
  `additional_redirect_urls`, and the preview addresses are not there on
  purpose (`.github/workflows/preview.yml` says why).

## Shipping a change

**Code only** (pages, API, anything under `cloud/web`). Merge. Deploy cloud
finds no migration to apply and deploys the Worker.

**A migration** (a policy, a function, a new column). `pnpm --filter
@yukibana/cloud-db exec supabase migration new <name>`, write it by hand, add
its pgTAP negatives, then `pnpm --filter @yukibana/cloud-db lint`, `reset`
and `test:db`. Merge; Deploy cloud applies it, and the "Migrations pending"
step in its log is the record of which files ran. Code that needs the
migration can ship with it: the Worker is deployed only after the
migration has gone out.

**A Supabase setting** (auth providers, redirect URLs, mail, rate limits:
`[remotes.production]` in `cloud/db/supabase/config.toml`). Merge; the
"Supabase settings, before" step prints what the push will change, and the
dashboard stays read-only. When code needs the setting, the two can ship
together for the same reason. Turning on the IDE's login (step 7) is this
case.

**Removing something.** Two deploys: first stop reading it and deploy,
then drop it in a later migration. An old Worker still running against a
dropped column is the failure this avoids.

**Worker configuration.** A non-secret value is `vars` in
`cloud/web/wrangler.jsonc` and ships with the next deploy. A secret is
`pnpm --filter @yukibana/cloud-web exec wrangler secret put <NAME>` from a
checkout, which takes effect at once and needs no deploy.

**Never by hand.** Deploy cloud has no "Run workflow" button: production
only ever gets a tree a pull request's CI run tested. A deploy that failed for a
reason outside the code (a secret, an outage) is retried with "Re-run failed
jobs" on its run while it is the newest; a re-run keeps the push it was
started by, so it deploys the same tested commit. Anything else is fixed
through a pull request, and the next merge deploys everything since the last
deploy. A re-run of a commit older than the last successful deploy's stops
before it changes anything, so that it cannot put an older Worker back.

## Rolling back

**The Worker.** Cloudflare keeps previous versions: the Worker's
Deployments tab in the dashboard, or `pnpm --filter @yukibana/cloud-web exec
wrangler rollback`, puts one back
in seconds. Because migrations only add, the older Worker works against the
newer schema. Then revert the commit on `main`, or the next push redeploys
what was rolled back.

**The database.** There are no down migrations. A migration that went out
wrong is corrected by a new migration that undoes or repairs it, reviewed
and pushed like any other. Never edit a migration that has run, and never
fix production by hand: the next drift run would fail, and the ledger would
no longer describe the database.

**Settings.** Revert the change to `cloud/db/supabase/config.toml` and let the
workflow push it again.

## Setting up an environment

Once per environment, in this order. Production already exists; this is
for a new one, or for finding out how the existing one was made.

## 1. Supabase

From the project dashboard, collect four things.

| What | Where |
| --- | --- |
| Project ref | The first label of the API URL, `https://<ref>.supabase.co` |
| Publishable (anon) key | Settings → API |
| **Session pooler** connection string | Connect → Session pooler, port 5432 |
| **Direct** connection string | Connect → Direct connection, port 5432 |

Both connection strings, and which goes where, matter:

* the **session pooler** string is what GitHub Actions uses. A direct
  connection resolves to IPv6 only, and GitHub's runners have no IPv6, so
  every database step would fail to connect. The pooler is IPv4 on every plan;
* the **direct** string is the shape Hyperdrive uses, but **not as it is
  given to you**. Both strings the dashboard hands out connect as `postgres`,
  and the Worker must connect as `yukibana_app`: see step 2. Hyperdrive is
  the pool, so pooling it twice is what you are avoiding.

Percent-encode the password inside the pooler string if it contains anything
outside `A-Za-z0-9._~-`. The Supabase CLI rejects a string that is not encoded.

Then create a **GitHub OAuth App** for login, at GitHub → Settings →
Developer settings → OAuth Apps → New. The callback URL is
`https://<ref>.supabase.co/auth/v1/callback`. Keep the client id and secret.
This is an OAuth App, not a GitHub App: the registry reads no repositories.

Login codes are mailed through **Resend**. Supabase's built-in mailer sends
only to your organisation's own members, a couple of mails an hour, and on
the free plan it refuses the code template, failing the whole auth push. At
resend.com, add the domain `yukibana.dev` and put the DNS records it shows
into Cloudflare, then create an API key with sending access. The rest is in
`cloud/db/supabase/config.toml` under `[remotes.production.auth.email.smtp]`; the
key is the `SUPABASE_AUTH_SMTP_PASS` secret below. Another provider, or
another sender address, is a change to that block.

Nothing else is configured by hand. The deploy workflow pushes the auth
settings from `cloud/db/supabase/config.toml`, and the schema comes from the
migrations. The dashboard is read-only from here on; `drift.yml` fails
nightly if something is changed there.

## 2. Cloudflare

**Enable R2** (dashboard → R2). It asks for a payment method; the free tier
is 10 GB of storage, 10 million reads a month and no egress charges.

**Create the bucket**, named `yukibana-cloud`, the same name local development and CI use.

**Create an R2 API token** (R2 → Manage API tokens → Create), with Object
Read & Write on that bucket. The page that follows shows three values, once:

| Shown as | Length | Use |
| --- | --- | --- |
| Token value | about 40–53 characters | **not used**: it is for Cloudflare's own API |
| Access Key ID | 32 hexadecimal characters | `S3_ACCESS_KEY_ID` |
| Secret Access Key | 64 hexadecimal characters | `S3_SECRET_ACCESS_KEY` |

The token value comes first and looks like a key, and pasting it as
`S3_ACCESS_KEY_ID` makes every upload fail; the Worker checks the shapes and
names the mistake. The same page shows the S3 API endpoint,
`https://<account id>.r2.cloudflarestorage.com`.

**Create the Hyperdrive config**, from a checkout. Note the user and the
password: `yukibana_app`, with the value you will put in `APP_DB_PASSWORD`
(step 5). The host and port are the direct connection's; the rest of that
string is not.

```bash
pnpm --filter @yukibana/cloud-web exec wrangler hyperdrive create yukibana-cloud \
  --connection-string="postgresql://yukibana_app:<APP_DB_PASSWORD>@db.<ref>.supabase.co:5432/postgres"
```

It prints an id. Hyperdrive is on the free plan, with 100,000 queries a day.

**Not `postgres`.** The string the dashboard offers connects as `postgres`,
and pasting it here is the one mistake that does not announce itself. That
role owns the tables, and a table's owner is not subject to its own policies
unless they are forced, which these migrations deliberately do not do — so
the whole authorisation model would be off, silently. It is also not a member
of `yukibana_publisher`, so publishing a release would fail while every page
kept working. This happened; `cloud/web/src/lib/server/db.ts` now answers such a
connection with a sentence naming it, which is how you would find out.

The password reaches the database from `APP_DB_PASSWORD` through
`cloud/db/ops/bootstrap.sql` on every deploy, so the two must be the same value. To
change it later, change the secret, deploy, then
`pnpm --filter @yukibana/cloud-web exec wrangler hyperdrive update <id> --connection-string=...`.

**Create an API token for the deploys** (My Profile → API Tokens → Create
Token → "Edit Cloudflare Workers"), limited to this account. Deploy cloud
deploys the Worker with it, and Preview uploads preview versions with it:
Cloudflare cannot limit a token to uploads, which is why the `preview`
environment needs a maintainer's approval (step 5). The Worker is not
connected to Workers Builds: the deploy workflow is the only thing that
deploys it, after the migrations.

Note the account id from the dashboard sidebar: it is the first label of the
R2 S3 endpoint, which `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` in
`cloud/web/wrangler.jsonc` hold.

## 3. Fill in the three placeholders

`node .github/scripts/production-config.mts` names them and where each lives;
the deploy workflow runs it first and refuses to deploy while any remain.

| Placeholder | Value |
| --- | --- |
| `REPLACE_ME_PROJECT_REF` | the Supabase project ref |
| `REPLACE_ME_HYPERDRIVE_ID` | the id `hyperdrive create` printed |
| `REPLACE_ME_WORKERS_SUBDOMAIN` | your workers.dev subdomain, so the app is at `https://yukibana-cloud.<subdomain>.workers.dev`, or the custom domain instead |

They are in `cloud/web/wrangler.jsonc` (production values, because that is
what is deployed and what a diff should show) and `cloud/db/supabase/config.toml` (under
`[remotes.production]`, which is what `config push` applies to the project;
everything above that block stays local). Commit the result.

One more value is the environment's own without being a placeholder:
`SITE_URL` in `cloud/web/wrangler.jsonc`, the address people use. It must be the
origin of `site_url` under `[remotes.production.auth]`; step 7 says why.

## 4. Worker secrets

Three, set once. The Worker already exists, so this works before the first
deploy. From the repository root, after
`pnpm --filter @yukibana/cloud-web exec wrangler login`:

```bash
pnpm --filter @yukibana/cloud-web exec wrangler secret put SUPABASE_PUBLISHABLE_KEY
pnpm --filter @yukibana/cloud-web exec wrangler secret put S3_ACCESS_KEY_ID
pnpm --filter @yukibana/cloud-web exec wrangler secret put S3_SECRET_ACCESS_KEY
```

They are not in the deploy workflow: a secret that is re-pushed on every
deploy is a secret that is in CI's environment on every deploy.

## 5. The environments' secrets

GitHub → Settings → Environments. Two environments, each with its own
secrets, which a job reads only if it names the environment.

**`production`**, named by Deploy cloud and Drift. Limit it to the `main`
branch (Deployment branches and tags).

| Secret | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | a personal access token, from the Supabase dashboard |
| `SUPABASE_PROJECT_REF` | the project ref |
| `SUPABASE_DB_URL` | the **session pooler** connection string, percent-encoded |
| `SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID` | the OAuth App's client id |
| `SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET` | the OAuth App's secret |
| `SUPABASE_AUTH_SMTP_PASS` | the Resend API key, for the login codes |
| `APP_DB_PASSWORD` | a password you generate for the `yukibana_app` role |
| `FIRST_ADMIN_EMAIL` | the address your GitHub account reports as primary |
| `CLOUDFLARE_API_TOKEN` | the API token of step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | the account id |

**`preview`**, named by Preview, with **required reviewers** (the
maintainers) so that each preview waits for one of them:
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the same values.

Put them on the environment's **Secrets**, not as repository secrets, which
every workflow could read, and not as variables, which are printed in plain
text in run logs: `SUPABASE_DB_URL` carries the database password. A secret
that is set shows up as `***` in a run's environment listing; one that is
blank there does not exist as far as the job is concerned. Until the
production configuration in step 3 is filled in, Deploy cloud stops with a
notice rather than failing, because nobody has pointed the repository at an
environment yet. Once it is filled in, a missing secret fails the run and
names itself.

`APP_DB_PASSWORD` is yours to invent: `cloud/db/ops/bootstrap.sql` sets it on the
connection role every deploy, so it never appears in a migration.

## 6. Deploy, log in, deploy again

Merge the pull request with step 3's configuration.
With no earlier deploy to compare with, Deploy cloud treats everything as
affected: it will check the placeholders are gone, list and apply pending
migrations, run `cloud/db/ops/bootstrap.sql`, push the Supabase settings, and
then build and deploy the Worker.

`cloud/db/ops/bootstrap.sql` sets the connection role's password and then tries to
promote the first admin. On a brand-new project it finds nobody to promote
and says so, because an account only exists once someone has logged in. So
**open the app, log in (with GitHub, or a code mailed to `FIRST_ADMIN_EMAIL`),
and re-run that run's Deploy job alone** (open the run, then the job's "Re-run
this job"). Re-running only that job keeps the plan's decision to deploy;
re-running every job would find the run itself as the last deploy and skip.
The second run promotes you, and every run after that is a no-op.

You are then an admin: `/admin` grants `teacher` to anyone who has logged in
once, and a teacher creates courses, editions and projects.

## 7. The IDE's OAuth client

The CLI and the IDE log in through the website: `/auth/connect` shows the
person whom they are signed in as, and on their say-so Supabase Auth's OAuth
2.1 server issues a code for the registry's own OAuth client, which the CLI
trades for a session of its own (`cloud/web/src/lib/connect.ts` says how and why).
The server is switched on by `[auth.oauth_server]` in `cloud/db/supabase/config.toml`,
which Deploy cloud pushes like any setting. The client is data,
not a setting, so it is registered once per environment, with the project's
secret key (Settings → API keys). Turning it on, in a new environment or in
one that runs without it, is four steps, in this order:

1. **The setting.** Merge with `[auth.oauth_server]` enabled, and wait for
   that Deploy cloud run to go green. Until it has pushed the setting, Auth has
   no OAuth server and the script below fails with a 404 from
   `/auth/v1/admin/oauth/clients`.
2. **The client.** From a checkout of `main`, with the key in a git-ignored
   file rather than on the command line, where it would stay in the shell's
   history (`.env` is ignored here):

   ```bash
   node --env-file=.env cloud/dev/scripts/oauth-client.mjs https://<ref>.supabase.co https://cloud.yukibana.dev
   ```

   where `.env` holds `SUPABASE_SECRET_KEY=<secret key>`. It prints the
   client's id, which is not a secret.
3. **The id.** Put it in `cloud/web/wrangler.jsonc` as `SUPABASE_OAUTH_CLIENT_ID` and
   merge. Deploy cloud deploys it.
4. **Check.** `curl https://cloud.yukibana.dev/api/auth/config` answers with
   the id as `oauthClientId` and the address as `siteUrl`. Then `yukibana
   login` prints a four-letter code and opens the website, which shows the
   same code beside "Continue as …".

The site address given to the script must be the
origin of Auth's `site_url` (`[remotes.production.auth]` in
`cloud/db/supabase/config.toml`) and of `SITE_URL` in `cloud/web/wrangler.jsonc`: Auth sends
the consent step to `site_url`, the client's one redirect URI is on that
origin, and the cookie that says the person clicked "Continue" is set
there, so a login started on any other address (the workers.dev one, say)
is moved there first. Until step 3 is deployed, the CLI and the IDE log in
with GitHub directly, as before, so nothing breaks between the steps.
Running the script again finds the client rather than making a second one,
and refuses to reuse a client of that name that is not public, has other
grants, or has more than one redirect URI. The secret key is
used for this and nowhere else: it is not a Worker secret and not a
repository secret.

## Afterwards

The migrations in this repository have been applied to the production
project as of 2026-09-18, so the ledger there records them. From that point
a migration that has run is frozen: every change is a new file, including a
change to something only ever deployed once. `cloud/CLAUDE.md` says the same thing;
this is the date it started being true.


Everything else is in the app. A teacher creates a course, an edition,
enrols by address, and creates a project. Publishing a release is
`docs/cloud/yukibana-json.md`: `yukibana build` and an upload, or a token and the
GitHub Action in the course repository.

## When something goes wrong

**"failed to connect" in a database step.** `SUPABASE_DB_URL` is the direct
connection string rather than the session pooler one. See step 1.

**The deploy refuses with a list of placeholders.** Step 3, and commit.

**Login redirects to localhost.** `[remotes.production]` in
`cloud/db/supabase/config.toml` still has the placeholder subdomain, or the deploy has
not pushed the settings yet. The pushed values are printed by the "Supabase
settings, before" step of the last deploy.

**A merge to `main` changed nothing on the site.** Look at the Deploy cloud
run titled `Deploy <commit>` for it, which starts with the push. Its plan job
prints which packages the change affected: when neither `@yukibana/cloud-web`
nor `@yukibana/cloud-db` is among them, nothing was deployed, by design, and
so is a change to CI or a root config alone. A plan that fails at "The pull
request's CI tested this tree" says which of its checks failed: no merged pull
request, a tree that differs from its head's (merged out of date), or no
passing run. A
failed run is retried with "Re-run failed jobs", and a run that waits on
another is the `deploy-cloud` concurrency group at work.
`/api/auth/config` answering without `siteUrl` is the sign that code from
before the website login is live.

**`yukibana login` or the IDE still goes straight to GitHub.** The deployed
`cloud/web/wrangler.jsonc` has no `SUPABASE_OAUTH_CLIENT_ID`: `/api/auth/config`
answers without `oauthClientId`. Step 7, 3. A CLI older than the website
login also goes to GitHub whatever the registry says; the IDE needs an
`@yukibana/cli` from after it.

**The website says the login expired or was already used.** Five minutes
passed between "Continue" and the browser coming back, or the browser
refuses the site's cookies.

**"Continue" answers 502 with what Auth's OAuth server said.** The Worker
asks Auth for the authorization itself (so that the consent route asks Auth
about no other), and Auth refused or sent it somewhere other than this
site's consent route: the client was registered for another address than
`site_url`'s, or `SUPABASE_OAUTH_CLIENT_ID` names no client. Run the script
again with the right address: it registers a client for it, and
`SUPABASE_OAUTH_CLIENT_ID` must be that client's id.

**The client script answers 404.** The OAuth server is not on yet: step 7,
1. The "Supabase settings, before" step of the last Deploy cloud run shows
whether `[auth.oauth_server]` has been pushed.

**A submission is rejected but a small one works.** The Worker hashes each
upload, and the Workers free plan allows about 10 ms of CPU per request.
Source archives are kilobytes and fine; a student who tars up `target/` can
exceed it. The fix is to have the client send its own SHA-256 and let R2
verify it, not a paid plan.

**The deploy fails on the Hyperdrive id.** The placeholders in
step 3 are not filled in, or `hyperdrive create` has not been run. The build
failing is the intended outcome: a Worker deployed with a placeholder id
starts and then fails every request that touches the database.

**Publishing a release answers 500, but every page works.** The Worker is
connected as a role that is not a member of `yukibana_publisher` — almost
always `postgres`, from pasting the dashboard's connection string into
Hyperdrive. The response says so since the day it was found; the fix is
`pnpm --filter @yukibana/cloud-web exec wrangler hyperdrive update <id> --connection-string=...` with
`yukibana_app` and `APP_DB_PASSWORD`, and no redeploy, since Hyperdrive is
read per request.

**Nightly Drift failed.** Something changed the database outside a migration.
The job prints the difference; either revert it in the dashboard or write it
down as a migration.
