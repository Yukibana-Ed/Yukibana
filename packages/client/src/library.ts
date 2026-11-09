/** `@yukibana/client`: what the IDE's extensions and the CLI (`packages/cli`)
 *  share, and only that. What one of them alone needs lives with it.
 *
 *  Four things, each usable without the others:
 *
 *  * **A submission bundle.** `createSubmissionBundle(folder)` reads the
 *    student's folder by its `yukibana.json`; the bundle lists its files
 *    (`files`, `skipped`, `problems`) and reads any of them (`read`) for a
 *    preview, and is only compressed when it is sent.
 *  * **A login.** `loginWithLoopback` gives a `Session`, through a listener
 *    on 127.0.0.1 and the host's browser; `startLogin(registry, redirect)`
 *    is the same login back to a route of the host's own (browser Theia,
 *    docs/cloud/theia.md). A `SessionStore` keeps the session (`memoryStore`
 *    here; the CLI keeps a file, an IDE its secret storage).
 *  * **A client.** `new YukibanaClient({ url, accessToken })` is the whole
 *    API as that person. `tokenProvider(store)` is an `accessToken` that
 *    refreshes the session as it goes.
 *  * **Archives.** Reading, writing and unpacking the `.tar.gz` everything
 *    travels as, and the two plans made of them: a teacher's assembly of a
 *    submission, and a student's update to a newer release.
 *
 *  ```ts
 *  const store = theiaSecretStore();              // a SessionStore
 *  const session = await loginWithLoopback(url, { open, callbackPage });
 *  await store.save(session);
 *  const client = new YukibanaClient({ url, accessToken: tokenProvider(store) });
 *
 *  const made = await createSubmissionBundle(workspaceFolder);
 *  if (!made.ok) return show(made.problems);
 *  preview(made.bundle.files, (path) => made.bundle.read(path));
 *  if (await confirmed()) await client.submit(made.bundle);
 *  ```
 *
 *  This entry is for Node: it reads the disk and opens sockets. What a
 *  `yukibana.json` says is the other entry, `@yukibana/client/config`,
 *  which is pure and safe in a browser.
 *
 *  The library is headless: it owns the protocol, the data, the disk and the
 *  network, and nothing a person sees. Opening a browser, the page the
 *  browser lands on after a login, and every word on a screen belong to the
 *  host (the CLI's are in `packages/cli/src/commands/`, the IDE's in its
 *  extensions).
 *  Errors carry a status and the registry's own sentence for the host to
 *  show or translate.
 */

export { createSubmissionBundle, type SubmissionBundle } from './bundle.js';
export { YukibanaClient, RegistryError } from './client.js';
export { startLogin, tokenProvider, logout, memoryStore, NotLoggedIn, type PendingLogin, type Session, type SessionStore } from './session.js';
export { loginWithLoopback, type CallbackOutcome } from './loopback.js';
export { loginCode } from './lib/pkce.js';
export { readArchive, unpackStarter, writeEntries, isEmptyDir } from './extract.js';
export { readTree } from './tree.js';
export { assemble, submissionRoot, tampered, type Tampering } from './lib/assemble.js';
export { escapes } from './lib/paths.js';
export { sha256Hex } from './lib/bytes.js';
export { gzip } from './lib/gzip.js';
export { planUpdate, wantedPaths, onlyTheStamp, isText, type Change, type ChooseReason, type Folder, type FolderEntry, type UpdatePlan, type Version } from './lib/update.js';
export { matcher } from './lib/glob.js';
export { displayName, folderNames, safeSegment, stampOf, type Person } from './lib/names.js';
export { writeTar, type Entry } from './lib/tar.js';
export type { Accepted, EditionRole, Me, Project, Release, Submission } from './lib/wire.js';
