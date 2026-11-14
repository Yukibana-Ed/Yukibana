# Working on the packages

`packages/client/` (`@yukibana/client`, the library the CLI and the IDE's
extensions share) and `packages/cli/` (`@yukibana/cli`, the `yukibana`
command) came from the cloud and follow its rules, so the cloud's guide is
imported below and loads with this file. Its sections on types, contract
documentation and tests apply here as they do in `cloud/`, and the client is
the one place that reads `yukibana.json` (`parseConfig`). The commands are in
[`docs/cloud/README.md`](../docs/cloud/README.md) and
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

Both are published to npm, by hand, from a `client-v<X.Y.Z>` or `cli-v<X.Y.Z>` tag (CONTRIBUTING.md,
Releasing); their `version` in git stays `0.0.0-dev`. The CLI bundles the client with esbuild (its `prepare`
script), so a client fix reaches CLI users only through a CLI release, and a runtime dependency of the client
the CLI should not bundle is listed both as an `--external:` there and in the CLI's `dependencies`.

@../cloud/CLAUDE.md
