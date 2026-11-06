# Contributing to Yukibana

## Prerequisites

- [pnpm](https://pnpm.io/installation), which runs every script on the Node.js 24 release that the root
  `package.json` names (`devEngines`), and downloads that release itself the first time
- [Node.js](https://nodejs.org/en/download/), if your pnpm needs one to run. Run tools through pnpm
  (`pnpm --filter <package> exec <tool>`), not `npx` or `npm` at the root: there npm enforces the root's exact Node.js release
  itself, cannot download it, and stops with `EBADDEVENGINES` on any other
- [Python 3](https://docs.python.org/3/using/index.html)

Some additional tools and libraries are needed depending on your platform,
see Theia's [own documentation](https://github.com/eclipse-theia/theia/blob/master/doc/Developing.md#prerequisites).

On Windows, the Visual Studio Build Tools also need the
"MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)" component
(Visual Studio Installer > Modify > Individual components).

## Setting up the environment

1. Download the repository
  
   ```bash
   git clone https://github.com/ISC-HEI/yukibana.git
   ```

2. Go into the project directory

   ```bash
   cd yukibana
   ```

3. Install the IDE's dependencies (which also checks that every `@theia/*` package has the same version),
   then build and start the app. `pnpm setup:cloud` and `pnpm setup:cli` install what the cloud or the CLI
   needs instead, without Electron or Theia, and `pnpm install` installs everything

   ```bash
   pnpm setup:ide
   pnpm start
   ```

   The first `pnpm start` also downloads the bundled plugins, which takes a while.

## Commands

All commands run from the repository root. The extensions compile incrementally,
so only the ones that changed are recompiled.

`pnpm lint`, `pnpm typecheck` and `pnpm test` cover every package, so they need every package installed
(`pnpm install`). After `pnpm setup:ide`, run them for what it installed the same way, e.g.
`pnpm --filter "{ide/**}..." test` (`"{cloud/**}..."` after `pnpm setup:cloud`, `@yukibana/cli...` after
`pnpm setup:cli`).

- `pnpm start [browser|electron]`: build in development mode, download the bundled
  plugins if needed, and start the app (Electron by default).
  Use `--prod` for a production build, and pass extra arguments to `theia start`
  after `--`, e.g. `pnpm start electron -- --log-config=../log-config.json` (`ide/log-config.json`)
- `pnpm build [browser|electron]`: build the extensions and the apps (both by default)
  in production mode, or in development mode with `--dev`
- `pnpm package`: build and package the Electron app into `ide/electron/dist`.
  Use `--preview` for an unpacked directory
- `pnpm download:plugins`: download the plugins listed in `theiaPlugins` (in `ide/package.json`) into `ide/plugins`,
  again whenever that list changes (done automatically by `start` and `package`; delete `ide/plugins` to download them again)
- `pnpm lint`, `pnpm typecheck`: run every package's `lint` (oxlint) or `typecheck` script, after `lint:root` or
  `typecheck:root` for the files no package owns; one package's with e.g. `pnpm --filter @yukibana/cli lint`.
  `pnpm lint:fix` fixes what oxlint can across the whole project
- `pnpm format` / `pnpm format:check`: format the whole project with oxfmt, or only check it (oxfmt reads neither
  Markdown nor Svelte components)
- `pnpm test`: run every package's unit tests with Vitest, straight from the sources, each with its package's
  `vitest.config` (the same as `pnpm -r test`, in one run);
  `pnpm test:watch` reruns them on every change. What a spec imports from another extension
  or library comes from its compiled `lib`, so rebuild that one after changing it (`pnpm setup:ide`
  compiles them all). Filter by file name and test name, e.g.
  `pnpm test config-provider -t "should reload"`
- `pnpm test:e2e`: build both apps in development mode and run the Playwright end-to-end
  tests ([ide/e2e/e2e](ide/e2e/e2e)) in each of them. Pick one app with `--project=browser` or
  `--project=electron`, and filter like `pnpm test`: `pnpm test:e2e scala -g "language"`.
  Playwright's own options work too, e.g. `--headed`, `--debug` or `--ui`. Before the
  first run, install Playwright's Chromium: `pnpm --filter @yukibana/ide-e2e exec playwright install chromium`
- `pnpm test:coverage`: run the unit tests and report their coverage, in `coverage/index.html`
- `pnpm clean`: remove what the extensions compiled and the apps bundled, e.g. after deleting
  or renaming source files, whose stale compiled files are otherwise left behind

To recompile the extensions on every change, run `pnpm watch`, and to rebundle an app,
`pnpm --filter @yukibana/ide-browser watch` (or `@yukibana/ide-electron`).

## Architecture

The IDE is in [ide](ide), separated into 4 main parts:
- the browser app ([ide/browser](ide/browser))
- the Electron app ([ide/electron](ide/electron))
- custom extensions ([ide/extensions](ide/extensions))
- helpers shared by the extensions ([ide/common](ide/common))

Each part is its own package of the pnpm workspace, and the end-to-end tests ([ide/e2e](ide/e2e)) are one too.
The commands above, run from the root, build and start them.
The extensions also use [@yukibana/client](packages/client), the library they share with the
[CLI](packages/cli); the cloud the IDE talks to is in [cloud](cloud).

Extensions that should be bundled with the IDE as builtin extensions
must be added as dependencies of the application (both [ide/browser](ide/browser)
and [ide/electron](ide/electron)).

More information can be found in [docs/architecture.md](docs/architecture.md).

### The cloud and the CLI

[cloud/web](cloud/web) (`@yukibana/cloud-web`, the Worker), [cloud/db](cloud/db) (`@yukibana/cloud-db`, the database
with the Supabase CLI and squawk) and [packages/cli](packages/cli) (`@yukibana/cli`) are packages of the same
workspace. `pnpm setup:cloud` or `pnpm setup:cli` installs them, and each has its own scripts, e.g.
`pnpm --filter @yukibana/cloud-web dev`, `pnpm --filter @yukibana/cli build`. The database's are `lint` (squawk over the
migrations), `start`, `stop`, `reset` and `test:db` (pgTAP), and any other Supabase command runs in `cloud/db` with
`pnpm --filter @yukibana/cloud-db exec supabase <command>`. The library the CLI and the IDE share,
[@yukibana/client](packages/client), compiles into its `lib` on install; rebuild it after changing it with
`pnpm --filter @yukibana/client prepare`. Their guide is [docs/cloud/CLAUDE.md](docs/cloud/CLAUDE.md).

The cloud's devcontainer is not where editors look for one (`.devcontainer/` at the root), so start it from the root
with `devcontainer up --workspace-folder . --config cloud/dev/.devcontainer/devcontainer.json`.

## Dependencies

Every dependency's version is in the catalog of [pnpm-workspace.yaml](pnpm-workspace.yaml); a `package.json` names it as
`catalog:` (`catalog:ts6` for `cloud/web`'s TypeScript 6), and a workspace package through the catalog's
`workspace:*`. The exception is `electron`, whose exact version Theia's CLI checks. pnpm only installs versions that are
at least 14 days old (`minimumReleaseAge`), and refuses a lockfile that holds a younger one. Dependabot waits as long
before proposing an update. The Node.js release in the root `package.json` (`devEngines`) is neither in the catalog nor
updated by Dependabot: whoever handles dependencies bumps it by hand to the newest 24.x release that is at least 14 days
old, on every Node.js security release and otherwise once a month.

`minimumReleaseAgeExclude` lets a younger release in. It is only for a fix to a vulnerability that affects us and is
being exploited, after checking the release's diff, provenance and announcement, and each entry names one exact
version (`pkg@1.2.3`), including each too-young dependency the release pulls in. `pnpm check:release-age` (run by CI)
fails once an entry's version is older than the window, so that the entry is removed.

Every npm package's license, and every plugin the IDE bundles, must be accepted by
[.github/scripts/licenses.mts](.github/scripts/licenses.mts): CI runs `pnpm check:licenses` when the lockfile or
`ide/package.json` changes. A new license or plugin is reviewed and added there.

## CI

[ci.yml](.github/workflows/ci.yml) runs for pull requests, the merge queue and pushes to `main`. Its plan job
([.github/scripts/plan.mts](.github/scripts/plan.mts)) asks pnpm which packages a change affects (the packages changed
since the base, Markdown aside, and every package depending on them) and runs their `lint`, `typecheck`, `test` and
`build` scripts; the cloud stack and the IDE's end-to-end tests run only when their packages are affected. A change to a
file that belongs to no package (the lockfile, a root config, `.github/`, `cloud/dev/`) runs every package's scripts,
the cloud stack and the end-to-end tests. The devcontainer is built when `cloud/dev/` or what installs read
(`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`) changed, and the license check runs when what it checks or its
rules changed. `ci-ok` is the one required check.
The files no package owns are checked by `pnpm lint:root`, `pnpm typecheck:root` and `pnpm test:root`.

[deploy-cloud.yml](.github/workflows/deploy-cloud.yml) deploys the cloud from `main`, and
[preview.yml](.github/workflows/preview.yml) uploads a pull request's Worker as a preview once a maintainer approves;
[docs/cloud/deploy.md](docs/cloud/deploy.md) describes both.

## Troubleshooting

### `Could not resolve path of module: @vscode/windows-ca-certs`

This native module failed to compile during `pnpm install`, but since it is
an optional dependency, the installation did not report an error.
Install the Spectre-mitigated libraries (see [Prerequisites](#prerequisites)),
then run `pnpm install --force`.
