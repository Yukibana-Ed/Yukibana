/** The build systems a project can be. The database enum `app.project_kind`
 *  is the source of truth; this list is what a form offers, and adding one
 *  is a migration there, a line here and a line in `@yukibana/client`'s
 *  `KINDS`, which a test compares with this one. What each kind means for an
 *  archive lives in the client, which the CLI makes archives with. Not
 *  imported from the client, so the Worker carries no config parser. */
export const KINDS = ['rust-cargo', 'scala-sbt'] as const;

/** A build system a project can be: one of `KINDS`. */
export type Kind = (typeof KINDS)[number];
