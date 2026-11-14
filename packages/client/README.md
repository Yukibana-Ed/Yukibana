# @yukibana/client

The library behind [Yukibana](https://github.com/Yukibana-Ed/Yukibana)'s IDE and its `yukibana` command
([`@yukibana/cli`](https://www.npmjs.com/package/@yukibana/cli)): the course registry's API, logging in, and the
archives course projects and submissions travel as. It is headless: it owns the protocol, the data, the disk and the
network, and nothing a person sees, so a host shows (and translates) every message itself.

```sh
npm install @yukibana/client
```

## What it does

Four things, each usable without the others:

- **A client.** `new YukibanaClient({ url, accessToken })` is the registry's whole API as one person. Each method is one
  request; a refusal is thrown as a `RegistryError` carrying the HTTP status and the registry's own sentence.
- **A login.** `loginWithLoopback(url, …)` logs in through the person's browser and a listener on 127.0.0.1, and gives
  a `Session`. A `SessionStore` keeps it (`memoryStore()` here; bring your own for a file or a secret store), and
  `tokenProvider(store)` is an `accessToken` that refreshes the session as it goes.
- **A submission bundle.** `createSubmissionBundle(folder)` reads a student's folder by its `yukibana.json` and lists
  what would be sent, so it can be previewed before `client.submit(bundle)`.
- **Archives.** Reading, writing and unpacking the `.tar.gz` everything travels as, and the two plans made of them: a
  teacher's assembly of a submission with a release, and a student's update to a newer release.

```ts
import { createSubmissionBundle, loginWithLoopback, memoryStore, tokenProvider, YukibanaClient } from '@yukibana/client';

const url = 'https://cloud.yukibana.dev';
const store = memoryStore();
const session = await loginWithLoopback(url, {
    open: loginUrl => console.log(`Open ${loginUrl} to log in`),
    callbackPage: () => '<p>Logged in. You can close this tab.</p>',
});
await store.save(session);
const client = new YukibanaClient({ url, accessToken: tokenProvider(store) });

const made = await createSubmissionBundle('./hw1');
if (made.ok) {
    console.log(made.bundle.files);
    await client.submit(made.bundle);
}
```

## Entry points

| Import                       | For                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `@yukibana/client`           | Node.js: the client, the login, bundles and archives. Reads disks and opens sockets. |
| `@yukibana/client/config`    | What a `yukibana.json` says (`parseConfig`, …). Pure, safe in a browser.              |
| `@yukibana/client/assembly`  | A submission put back together with a release's teacher archive. Pure, browser-safe. |
| `@yukibana/client/yukibana.schema.json` | The JSON schema of `yukibana.json`, for editors.                           |

The package is ESM only and ships its TypeScript types; every export carries its contract in its doc comment.

## License

[MIT](LICENSE). Issues and sources: <https://github.com/Yukibana-Ed/Yukibana>.
