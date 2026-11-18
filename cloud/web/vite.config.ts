import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UserConfig } from 'vite';

/** The commit this build is, for `version` in `$app/env`, which every
 *  incident report names (#lib/incident): Cloudflare's build says it in
 *  WORKERS_CI_COMMIT_SHA, a checkout in git. Without either, SvelteKit's
 *  default, the build's time, still tells one deploy from another. */
function commit(): string | undefined {
    const fromCi = process.env['WORKERS_CI_COMMIT_SHA'];
    if (fromCi !== undefined && fromCi !== '') return fromCi.slice(0, 12);
    try {
        return (
            execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
                .toString()
                .trim() || undefined
        );
    } catch {
        return undefined;
    }
}
const name = commit();

/** The design package's folder, wherever it is installed. As a workspace
 *  package it is a link out of node_modules to packages/design, which the
 *  dev server's file list (SvelteKit's: src, node_modules and its own) does
 *  not cover, so the fonts its CSS names were refused with 403 in
 *  development. The build bundles them and needs nothing. */
const design = dirname(fileURLToPath(import.meta.resolve('@yukibana/design/package.json')));

/** Where the dev server's vars and secrets come from. Normally .dev.vars
 *  beside wrangler.jsonc, as for `pnpm dev`. With YUKIBANA_VARS_FROM_PROCESS
 *  set to `true`, which the integration suite's app sets
 *  (tests/integration/app.ts), from the process's environment alone, so the
 *  suite configures the app it serves the same way locally as in CI, where
 *  there is no .dev.vars: wrangler reads the environment
 *  (CLOUDFLARE_INCLUDE_PROCESS_ENV) only when it loads no .dev.vars, and it
 *  loads none when given env files, so it is given one that does not exist.
 *  Until this, a local .dev.vars silently replaced what the suite asked
 *  for: its SITE_URL, and the suite's GitHub App was off. */
const envFiles = process.env['YUKIBANA_VARS_FROM_PROCESS'] === 'true' ? { envFiles: ['.env.none-yukibana-vars-from-process'] } : {};

/** One Worker serves the pages and the API. In development the adapter
 *  emulates the Worker's bindings (Hyperdrive, vars, secrets from .dev.vars)
 *  from wrangler.jsonc behind `cloudflare:workers`, so the env is the same
 *  shape on a laptop as in production. SvelteKit 3 takes its configuration
 *  here, in the plugin; there is no svelte.config.js. */
export default {
    plugins: [
        sveltekit({
            ...(name === undefined ? {} : { version: { name } }),
            adapter: adapter({
                // The Worker's configuration, beside this file, which `wrangler
                // deploy` reads too. Development reads the same file.
                platformProxy: { configPath: './wrangler.jsonc', persist: true, ...envFiles },
            }),
        }),
    ],
    server: { fs: { allow: [design] } },
} satisfies UserConfig;
