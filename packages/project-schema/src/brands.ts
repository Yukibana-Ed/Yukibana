/** The rules TypeScript cannot see in a type, as zod brands: a value of one of these types has been through its
 *  schema, because nothing else makes one. Each is branded `inout`, so a file's input type and its output type are the
 *  same (a type test holds them equal): a migration or a literal that needs one parses it. */

import * as z from 'zod';

/** A list of globs relative to the project root: no pattern is empty, starts with `/`, or has a `..` segment, so none
 *  can reach outside the project. `*` stays within a path segment, `**` crosses segments, `?` is one character. */
export const globsSchema = z
    .array(z.string())
    .check(
        z.refine((list: string[]) => list.every(s => s !== ''), 'must be a list of paths'),
        z.refine((list: string[]) => !list.some(s => s.startsWith('/') || s.split('/').includes('..')), 'paths are relative to the project root'),
    )
    .brand<'Globs', 'inout'>();
/** A list of globs relative to the project root, made only by `globsSchema`. */
export type Globs = z.output<typeof globsSchema>;

/** A registry project's id: a uuidv7, because the database makes every one with `app.uuidv7()`. In lower case, as
 *  the database prints it; a file that spells one in upper case is refused rather than rewritten, since a schema here
 *  has no transforms. */
export const projectIdSchema = z
    .string()
    .check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'must be a project id, a uuidv7 in lower case'))
    .brand<'ProjectId', 'inout'>();
/** A registry project's id, made only by `projectIdSchema`. */
export type ProjectId = z.output<typeof projectIdSchema>;

/** A release's id: a uuid in lower case, the release row's own id, which `yukibana build` chooses before the upload. */
export const releaseIdSchema = z
    .string()
    .check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'must be a release id, a uuid in lower case'))
    .brand<'ReleaseId', 'inout'>();
/** A release's id, made only by `releaseIdSchema`. */
export type ReleaseId = z.output<typeof releaseIdSchema>;
