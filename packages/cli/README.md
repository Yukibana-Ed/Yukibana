# @yukibana/cli

The `yukibana` command: [Yukibana](https://github.com/Yukibana-Ed/Yukibana)'s course registry from a terminal. Students
download a project's starter and submit their work; teachers check, build and publish a course project, download and
assemble submissions, and manage who is enrolled. Everything runs as the person who is logged in, and shows what their
role lets them see.

## Install

Needs Node.js 24 or later.

```sh
npm install --global @yukibana/cli
yukibana --help
```

Or without installing: `npx @yukibana/cli --help`.

## Log in

```sh
yukibana login --url https://cloud.yukibana.dev
yukibana whoami
```

`login` opens your browser and keeps the session in a file of your user's, so later commands need no `--url`.
`YUKIBANA_ACCESS_TOKEN` stands in for a login, e.g. in CI.

## Students

```sh
yukibana projects --open                 # the projects taking submissions
yukibana starter <project> --out ./hw1   # download and unpack the starter
cd hw1
yukibana pack                            # what submit would send, without sending it
yukibana submit                          # list what will be sent, ask, send
```

## Teachers

```sh
yukibana check                           # build the course project in memory and report problems
yukibana build --out dist                # write starter.tar.gz and teacher.tar.gz
yukibana publish --project <id>          # publish a release
yukibana submissions <project> --latest
yukibana download <project> --out subs --assemble
yukibana enrol <edition> alice@example.org bob@example.org
```

`<project>` defaults to `--project`, then `YUKIBANA_PROJECT`, then the `projectId` in `./yukibana.json`. Lists print as
JSON with `--json`. `yukibana --help` lists every command and option.

## Library

The commands are a thin layer over [`@yukibana/client`](https://www.npmjs.com/package/@yukibana/client), which this
package bundles: install that one to use the registry from your own code.

## License

[MIT](LICENSE). Issues and sources: <https://github.com/Yukibana-Ed/Yukibana>.
