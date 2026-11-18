# The CLI and the library

`packages/cli/` (`@yukibana/cli`) is the `yukibana` command, and
`packages/client/` (`@yukibana/client`) the library it and the IDE's Theia
extensions share (`packages/client/src/library.ts` and, for what a
`yukibana.json` says, `packages/client/src/config.ts` are its whole surface).
Every command is a thin layer over the library, so what the terminal does,
the IDE can do the same way.

## Logging in

```bash
yukibana login --url https://cloud.yukibana.dev
```

opens the browser at GitHub, through the registry's Supabase Auth, and comes
back to a listener on `127.0.0.1` on a free port (OAuth with PKCE: the code
in the browser is worthless without a secret that never leaves the CLI). The
session is stored in `~/.config/yukibana/session.json` (or under
`$XDG_CONFIG_HOME`, or `$YUKIBANA_CONFIG_DIR`), readable by its owner only,
and refreshed as it is used. `yukibana logout` ends it at the server too.

The Auth server only redirects to addresses on its allow list;
`cloud/db/supabase/config.toml` allows `http://127.0.0.1:*/callback` locally and in
production. Where no browser can reach the machine, `YUKIBANA_ACCESS_TOKEN`
stands in for a login.

## Commands

What a command shows is what your role lets you see: the registry runs every
request as you, and the database's policies decide.

| | |
| --- | --- |
| `whoami`, `editions`, `members <edition>` | who you are, where you are enrolled, a roster (staff see everyone) |
| `projects [--edition id] [--open]` | your projects; `--open` keeps the ones taking submissions from you now |
| `project [<id>]`, `releases [<id>]` | one project; its releases (staff) |
| `starter <id> [--out dir]` | download the starter and unpack it into `dir`, by default `./<project slug>/`; the folder must be missing or empty |
| `pack [dir] [--out file]` | list what `submit` would send, and write the archive: to `--out`, or by default into a new folder under the system's temporary directory, never into the project. `submit` itself writes nothing to disk |
| `submit [dir] [--yes]` | list what would be sent, ask, send. The project is the one in `./yukibana.json` |
| `submissions [<id>] [--latest] [--student-submissions who]` | newest first; staff see everyone's; late ones marked, with the release each started from, and a warning for each not based on the newest release |
| `download [<id>] [--out dir]` | each student's newest submission, unpacked into `dir/<student name>/`; a warning for each not based on the newest release |
| `  --all-versions`, `--submission id` | every version (or the named ones) into `dir/<student name>/<time>/` |
| `  --student-submissions who` | some students' submissions: a name, GitHub login, address or user id (repeatable; `--student` is the old name and still works, with a warning) |
| `  --assemble` | overlay a release's read-only and hidden files and report what the student changed of the release they started from |
| `  --release id\|newest` | with `--assemble`: which release to overlay. By default each submission's own (the newest when unknown); an id must be one of the project's releases |
| `  --archive` | keep each `.tar.gz` as sent |
| `assemble <submission> --teacher <archive or dir> --out dir` | the same from files already here |
| `check`, `build`, `publish [dir]` | a teacher's release, as before; `publish` takes a project token or your login |
| `publish [dir] --ci [--label text]` | in GitHub Actions, in a repository linked to projects: a release of each of them, with the job's OIDC token (below) |
| `enrol`, `unenrol <edition> <email>...` | owners |

`download` writes `yukibana-download.json` beside the folders: which folder is
whose, the submission id, time and SHA-256, the release it started from and
the one it was assembled with, and what an assembly found.
Student names become folder names that every filesystem accepts (no
separators or reserved characters, no reserved Windows names, no leading
dot); two students whose names match, ignoring case, both get their GitHub
login added. Every download is checked against the SHA-256 the registry
recorded on arrival.

## Publishing from GitHub Actions

In a repository an owner has linked to projects on the project page
(`docs/cloud/github.md`), the job publishes with no token at all:

```bash
yukibana publish . --ci --url https://cloud.yukibana.dev --label v3
```

which is what the Action runs when it is given neither `token` nor
`project`. The workflow needs `permissions: id-token: write`, and the run
must be at a tag. CI mode is only ever explicit:

* `--ci` with `--token` or `--project` is refused before anything is built.
  `YUKIBANA_TOKEN`, `YUKIBANA_PROJECT` and a `projectId` in `yukibana.json`
  are ignored, with a warning, since a repository made from a template may
  well name the template's project.
* The CLI asks GitHub for an OIDC token whose audience is the origin of
  `--url` (a trailing slash or a path makes no difference), a fresh one for
  every request, and never prints it. The registry accepts only its own
  canonical address, and says which one when they differ.
* It asks the registry which projects the repository is linked to, prints
  the repository, ref and commit, then every project, published or skipped
  with the registry's reason, and builds and publishes once per project,
  each starter with its own project id and release id, each release with
  the token's commit (a warning says so when the checkout is at another).
* One project's failure does not stop the others. The command exits
  non-zero naming every project not published, so a green job never means
  fewer releases than the log suggests. A repository linked to nothing
  fails with a sentence pointing at the project page.
* **A re-run publishes again**, as a re-run with a token does: re-running a
  tag's job, or re-tagging the same commit, makes a new release of each
  project. A release of identical content costs a student at most an update
  that changes no file. Skipping a commit already published was planned and
  dropped in review, because it would silently swallow a release re-tagged
  on purpose.

## The library, for the IDE extension

`docs/cloud/theia.md` is the full guide to embedding it, and
`ide/extensions/yukibana-cloud` the IDE's use of it.

```ts
import {
  createSubmissionBundle, YukibanaClient, startLogin, loginWithLoopback, tokenProvider, type SessionStore,
} from '@yukibana/client';

// Log in: either back to a listener on 127.0.0.1 (desktop Theia), with the
// host opening the address and writing the page the browser lands on…
const session = await loginWithLoopback(registry, { open: openExternal, callbackPage });
// …or with a redirect of the IDE's own (browser Theia), added to the
// Auth server's allow list:
const pending = await startLogin(registry, 'https://ide.example/yukibana/callback');
openInIde(pending.authorizeUrl);
const session2 = await pending.finish(callbackUrlTheIdeReceived);

// Keep it where the IDE keeps secrets.
const store: SessionStore = { load, save, clear };
await store.save(session);
const client = new YukibanaClient({ url: registry, accessToken: tokenProvider(store) });

// Prepare, preview, and only then send.
const made = await createSubmissionBundle(workspaceRoot);
if (!made.ok) return showProblems(made.problems);
const { bundle } = made;
bundle.files;                // [{ path, type, size, mode }], what will be sent
bundle.skipped;              // what the rules left out
bundle.problems;             // reasons it must not be sent
bundle.read('src/Main.scala'); // the exact bytes, for a preview
if (await userConfirms()) await client.submit(bundle);
```

`YukibanaClient` takes `accessToken` as a function, so the credentials can
come from anywhere: `tokenProvider` over a stored session refreshes it and
never lets two refreshes race (the refresh token rotates). It is the whole
API: `me`, `editions`, `members`, `enrol`, `unenrol`, `projects`, `project`,
`submissions`, `releases`, `submit`, `submitArchive`, `publishRelease`,
`ciProjects`, `downloadSubmission`, `downloadStarter`, `downloadRelease`.
`accessToken` may also give a GitHub Actions OIDC token, which is good for
`ciProjects` and `publishRelease` to a linked project and nothing else; a
release's `publishedFrom` is the repository that published it, or null. A refusal is a
`RegistryError` with the HTTP status and the registry's sentence;
`NotLoggedIn` means log in again.

## Windows and late work

A student sees an exercise while its window is open: from its "available
after" date until its "closes" date (none: never), set on the project page.
The deadline sits inside the window and is not a wall: `projects` shows
`late` past it, `submit` still sends and says the submission is recorded as
late, and `submissions` and `download` mark late work (`yukibana-download.json`
has a `late` field per submission). Late means submitted after the deadline
as it is now, so extending a deadline makes earlier late work on time.

## The HTTP API

All JSON, all as the caller (a bearer access token, or the session cookie
for reads). The shapes are `cloud/web/src/lib/api.ts`.

| | |
| --- | --- |
| `GET /api/auth/config` | the Auth server and its publishable key, for a login |
| `GET /api/me` | |
| `GET /api/editions` | |
| `GET /api/editions/{id}/members` | |
| `POST /api/editions/{id}/members` | `{ "email", "role" }`, bearer only |
| `DELETE /api/editions/{id}/members?email=` | bearer only |
| `GET /api/projects[?edition=]` | |
| `GET /api/projects/{id}` | |
| `GET /api/projects/{id}/submissions[?latest=true&author=]` | |
| `POST /api/projects/{id}/submissions` | the `.tar.gz` as the body |
| `GET /api/projects/{id}/releases` | |
| `POST /api/projects/{id}/releases` | multipart; a project token, a person's bearer, or a linked repository's GitHub Actions OIDC token (then the commit is the token's) |
| `GET /api/ci/projects` | a GitHub Actions OIDC token only: `{ repository, ref, sha, moved, projects: [{ id, slug, title, edition, refused }] }`, the projects linked to the token's repository and why any would be refused |
| `GET /api/projects/{id}/starter`, `/api/submissions/{id}`, `/api/releases/{id}/{starter,teacher}` | a redirect to a presigned URL good for a minute |

Writes refuse a cookie: a bearer header is never sent by a browser on
another site's behalf, a cookie is.
