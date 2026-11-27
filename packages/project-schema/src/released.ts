/** The versions of each file that have been released: a file of one of them may exist in a course repository, so its
 *  JSON Schema never changes again. `tests/json-schema.test.ts` compares a released version's file in `schemas/` byte
 *  for byte and never rewrites it, and the registry serves it as immutable. Empty until the first release of the
 *  CLI and IDE that read these files adds `1` (issue 10). */
export const RELEASED: Readonly<Record<'yukibana' | 'yukibana-release', readonly number[]>> = {
    yukibana: [],
    'yukibana-release': [],
};
