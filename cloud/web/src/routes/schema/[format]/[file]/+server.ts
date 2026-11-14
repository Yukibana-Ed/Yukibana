import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { schemaFiles } from '@yukibana/project-schema';

/** Every version's JSON Schema by its path, `yukibana/v1.json`: the files `@yukibana/project-schema` commits in its
 *  `schemas/`, which its tests hold equal to what `schemaFiles` generates, so the Worker serves those bytes without
 *  bundling the files. Generated once per isolate, on the first request. A dependency, so a new version deploys with
 *  the code that reads it. */
let byPath: ReadonlyMap<string, { readonly text: string; readonly released: boolean }> | undefined;

/** The JSON Schema of one version of `yukibana.json` or `yukibana.release.json`, at the URL its `$id` and a file's
 *  `$schema` name: `/schema/yukibana/v1.json`. Anyone may fetch it, from any origin. A released version never changes,
 *  so it is cached forever; an unreleased one may change with a deploy, so for five minutes. Any other name is a 404,
 *  a version this registry does not know included. */
export const GET: RequestHandler = ({ params }) => {
    byPath ??= new Map(schemaFiles().map(f => [f.path, f]));
    const file = byPath.get(`${params.format}/${params.file}`);
    if (file === undefined) error(404, 'No such schema.');
    return new Response(file.text, {
        headers: {
            'content-type': 'application/schema+json',
            'access-control-allow-origin': '*',
            'cache-control': file.released ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
        },
    });
};
