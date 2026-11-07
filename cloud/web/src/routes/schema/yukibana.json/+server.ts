/**
 * SPDX-License-Identifier: MIT
 */
import type { RequestHandler } from './$types';
// @yukibana/client generates this file from the schema its parser checks with (its
// yukibana.ts and schema test); the registry only publishes it, so the two share a
// document and no code. A dependency, so that a change to the schema deploys.
import schema from '@yukibana/client/yukibana.schema.json?raw';

/** The JSON Schema of `yukibana.json`, at the URL its `$id` names, for an
 *  editor that a file's `$schema` points here. Anyone may fetch it, from any
 *  origin; it changes only with a deploy, so a day's caching is safe. */
export const GET: RequestHandler = () =>
    new Response(schema, {
        headers: {
            'content-type': 'application/schema+json',
            'access-control-allow-origin': '*',
            'cache-control': 'public, max-age=86400',
        },
    });
