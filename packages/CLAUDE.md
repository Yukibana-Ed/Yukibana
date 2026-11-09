# Working on the packages

`packages/client/` (`@yukibana/client`, the library the CLI and the IDE's
extensions share) and `packages/cli/` (`@yukibana/cli`, the `yukibana`
command) came from the cloud and follow its rules: read
[`cloud/CLAUDE.md`](../cloud/CLAUDE.md) before changing them. Its sections on
types, contract documentation and tests apply here as they do in `cloud/`,
and the client is the one place that reads `yukibana.json`
(`parseConfig`). The commands are in [`docs/cloud/README.md`](../docs/cloud/README.md)
and [`CONTRIBUTING.md`](../CONTRIBUTING.md).
