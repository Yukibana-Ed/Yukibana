# Yukibana Cloud

Course projects and the work students submit for them. The cloud is a
registry. A teacher publishes a release, two archives built from the course
repository by the CLI (on their machine, or in the repository's own CI
through the GitHub Action): the starter with the hidden tests removed, and
the whole project for staff. Students download the starter while the
project's window is open and submit their solution as a `.tar.gz`, late if
after the deadline; staff read the submissions.

This page is how to run it. [architecture.md](architecture.md) is what the
parts are and how they connect, [design.md](design.md) why it is shaped the
way it is, [yukibana-json.md](yukibana-json.md) the contract a course
repository follows, [cli.md](cli.md) the CLI and the library the IDE uses,
[theia.md](theia.md) how the IDE embeds it, [deploy.md](deploy.md) how it
ships, and [cloud/CLAUDE.md](../../cloud/CLAUDE.md) how the code is written.

| | |
| --- | --- |
| Postgres and Auth | Supabase, in `cloud/db` (`@yukibana/cloud-db`). The schema is `cloud/db/supabase/migrations/`, applied by the deploy workflow and by nothing else. |
| The app | SvelteKit in `cloud/web` (`@yukibana/cloud-web`), one Cloudflare Worker, Postgres through Hyperdrive as a role that can bypass no policy. |
| The CLI | `packages/cli` (`@yukibana/cli`): a teacher's `check`, `build`, `publish`, `download`, `assemble`; a student's `login`, `projects`, `starter`, `submit`. It and the IDE share `packages/client` (`@yukibana/client`). `action/` wraps the CLI as a GitHub Action. |
| Files | Cloudflare R2 over S3 in production, RustFS over S3 locally (`cloud/dev/compose.yml`). The database holds keys. |
| Login | Supabase Auth: GitHub, or a one-time code by email, in the browser. The CLI (`yukibana login`) and the IDE log in through the website, as the account the person confirms there. Publishing from CI uses a per-project token instead. |

Every command below runs from the repository's root.

## Start

The devcontainer has everything. It is in `cloud/dev/.devcontainer/`, not
where editors look for one, so start it with the
[devcontainer CLI](https://github.com/devcontainers/cli):

```bash
devcontainer up --workspace-folder . --config cloud/dev/.devcontainer/devcontainer.json
devcontainer exec --workspace-folder . --config cloud/dev/.devcontainer/devcontainer.json pnpm --filter @yukibana/cloud-dev smoke
```

It installs the cloud and the CLI, and on every start (re)starts the
Supabase stack and the bucket and writes `cloud/web/.dev.vars`. They run as
sibling containers on the host's Docker daemon (docker-outside-of-docker).
The first start pulls a few gigabytes of images; after that it is seconds.

Without a devcontainer, on a machine with Docker and pnpm
([CONTRIBUTING.md](../../CONTRIBUTING.md#prerequisites)):

```bash
pnpm setup:cloud                                  # the cloud's packages; `pnpm install` installs everything
cp cloud/dev/.env.example cloud/dev/.env          # a GitHub OAuth App for local login (optional to start)
set -a; . cloud/dev/.env; set +a                  # Auth reads them when the stack starts
pnpm --filter @yukibana/cloud-db start            # Supabase
pnpm --filter @yukibana/cloud-dev storage:start    # the bucket
pnpm --filter @yukibana/cloud-dev dev:vars        # cloud/web/.dev.vars, from what the stack reports
pnpm --filter @yukibana/cloud-web dev             # http://127.0.0.1:5173
```

Open the app as 127.0.0.1 or localhost, not a LAN address: the session
cookies are `__Host-` cookies, which must be Secure, and browsers keep a
Secure cookie over plain http only for those two hosts.

Log in with GitHub, or by email code: every mail the local stack sends lands
in its catcher at http://127.0.0.1:54324, so any address works, including the
seeded alice@, bob@, ta@ and teacher@yukibana.local. Then make yourself the
admin of the local database:

```bash
pnpm --filter @yukibana/cloud-dev admin you@example.com
```

## Daily use

| | |
| --- | --- |
| `pnpm --filter @yukibana/cloud-web dev` | the app, against the local stack |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` | formatting, lint, typecheck, unit tests: the fast half of CI, for every package. One package's with `pnpm --filter <package> <script>` |
| `pnpm --filter @yukibana/cloud-dev smoke` | is the stack reachable from here? |
| `pnpm --filter @yukibana/cloud-db reset` | rebuild the local database from every migration, then the seeds |
| `pnpm --filter @yukibana/cloud-db test:db` | the pgTAP suite |
| `pnpm --filter @yukibana/cloud-db lint` | squawk over the migrations, oxlint over the Edge Functions |
| `pnpm --filter @yukibana/cloud-web test:integration` | the server modules against the real stack |
| `pnpm --filter @yukibana/cloud-db exec supabase migration new <name>` | a new, empty migration to write by hand |
| `pnpm --filter @yukibana/cloud-db stop` | stop the stack (keeps your data; `exec supabase stop --no-backup` does not) |
| `pnpm --filter @yukibana/cloud-dev storage:stop` | stop the bucket (keeps its volume) |

A `reset` empties Auth's tables, and with them the OAuth client the CLI and
the IDE log in through: delete `cloud/web/.dev.vars` and run `dev:vars` again
after one.

## URLs

Same stack, two addresses: a devcontainer and the Supabase containers are
siblings, so they do not share a "localhost".
`pnpm --filter @yukibana/cloud-db exec supabase status` prints whichever is
right for where you run it, and `.dev.vars` is written the same way.

| | From the host browser | From inside the devcontainer |
| --- | --- | --- |
| API / Auth | http://localhost:54321 | http://host.docker.internal:54321 |
| Studio | http://localhost:54323 | — |
| Mail catcher | http://localhost:54324 | — |
| Postgres | `localhost:54322` | `host.docker.internal:54322` |
| Bucket (S3) | http://localhost:9000 | http://host.docker.internal:9000 |
| The app | http://localhost:5173 | http://127.0.0.1:5173 |

## Publishing a project

A course repository carries a `yukibana.json` ([yukibana-json.md](yukibana-json.md)).
Install the CLI (`pnpm install`, or on its own `pnpm setup:cli`, which also
compiles it; after changing it, `pnpm --filter @yukibana/cli prepare`) and give
it a name, then run it from the course repository's checkout:

```bash
alias yukibana="node $PWD/packages/cli/lib/index.js"

cd <course checkout>
yukibana check .                    # what would be hidden; exit 1 on a problem
yukibana build . --out .yukibana    # starter.tar.gz and teacher.tar.gz
yukibana publish . --project <id> --url <registry> --token <token>
```

After `yukibana login`, `publish` works without a token for a project you
are staff of. The project id is on the project page, and so is a publishing
token (owners only).

In the course repository's own CI, the Action does the same on every push:

```yaml
- uses: actions/checkout@v4
- uses: Yukibana-Ed/Yukibana/action@main
  with:
    url: https://yukibana.example.org
    project: ${{ vars.YUKIBANA_PROJECT }}
    token: ${{ secrets.YUKIBANA_TOKEN }}
```

## Collecting submissions

```bash
yukibana login --url <registry>
yukibana submissions <project> --latest
yukibana download <project> --out grading --assemble   # one folder per student
```

[cli.md](cli.md) has every command, and the library the IDE uses to let a
student preview and send a submission.

Login is a GitHub **OAuth App** (Settings → Developer settings → OAuth
Apps), one per environment, with callback URL `<API URL>/auth/v1/callback`.
Its id and secret go in `cloud/dev/.env` locally and in the deploy secrets in
production. No GitHub App and no webhooks: the registry never reads a
repository.

## Deploying

[deploy.md](deploy.md) is the pipeline, how a change ships and rolls back,
and the setup runbook. In short, when a pull request merges into `main`, up to
date with it and with its CI passed, `deploy-cloud.yml` applies the migrations, runs `cloud/db/ops/bootstrap.sql`
(role passwords and the first admin, from secrets), pushes the Supabase
settings, and then deploys the Worker. A nightly job (`drift.yml`) fails if
production differs from the migrations, which is how "the dashboard is
read-only" is enforced rather than hoped for.
`node .github/scripts/production-config.mts` lists the values a new
environment still has to fill in, and the deploy workflow runs it before
anything else.

## Other environments

```bash
cloud/dev/scripts/preflight.sh
```

probes the real Docker daemon and says whether this setup can work there.
The decisive check is whether the workspace path is valid on the daemon's
host, which is why `devcontainer.json` mounts the workspace at its host path,
and why this breaks inside a GitHub Actions `container:` job. CI runs the
stack directly on a VM runner and, separately, builds the devcontainer so a
broken one fails a pull request (both in `ci.yml`).
