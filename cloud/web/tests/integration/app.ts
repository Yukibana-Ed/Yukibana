/** The app itself, served over HTTP the way `pnpm --filter @yukibana/cloud-web dev` serves it, for a
 *  suite that must go through everything a browser's request goes through:
 *  the hook, the routing, the cookies, and the routes' own code, against
 *  the local stack.
 *
 *  The configuration comes from `config` (tests/integration/env.ts), handed
 *  to the Worker's emulation as process environment, and from nothing else:
 *  a `.dev.vars` in cloud/web, which `pnpm --filter @yukibana/cloud-web dev`
 *  reads, is ignored here (YUKIBANA_VARS_FROM_PROCESS, see vite.config.ts),
 *  so the app the suite serves is configured the same locally as in CI.
 *  It used to win over the environment, and the app then ran with its
 *  SITE_URL and without the suite's GitHub App.
 *
 *  `vite dev` turns SvelteKit's own origin check off, which is why a suite
 *  that shows a forged request is refused must run here: what refuses it is
 *  then this app's rule (#lib/server/forgery), not the framework's.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './env.js';

/** The GitHub App the served app is configured with: one that does not
 *  exist, so that the GitHub routes and the Repository section are on, and
 *  the suites can show they are refused before GitHub is asked (a request
 *  that reached GitHub with these would fail differently, with a 502). The
 *  tests that need a cookie this app would seal use `clientSecret`. */
export const GITHUB_APP = { clientId: 'Iv1.yukibana-tests', clientSecret: 'not-a-real-client-secret', slug: 'yukibana-tests' } as const;

export interface App {
    /** Where the app answers, `http://127.0.0.1:<port>`, with no trailing slash. */
    readonly origin: string;
    /** Stops the server. Safe to call twice. */
    stop(): Promise<void>;
}

/** A TCP port nobody listens on at the moment of asking. */
async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('no port'))));
        });
    });
}

/** Starts the app and waits until it answers a page, at most `timeoutMs`.
 *  `extraEnv` is added to the server's environment last, so a suite can
 *  preload a stand-in (`NODE_OPTIONS`, see github-keys.ts).
 *  A server that exits or never answers fails with its own output, so the
 *  reason is in the test log rather than "fetch failed". */
export async function startApp(timeoutMs = 90_000, extraEnv: NodeJS.ProcessEnv = {}): Promise<App> {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const appDir = fileURLToPath(new URL('../..', import.meta.url));
    // Wherever pnpm put vite: hoisted to the root, or in cloud/web's own node_modules when another version is hoisted.
    const vite = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
        // This environment, and not cloud/web/.dev.vars, configures the app (vite.config.ts).
        YUKIBANA_VARS_FROM_PROCESS: 'true',
        WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: config.databaseUrl,
        PUBLIC_SUPABASE_URL: config.supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: config.supabasePublishableKey,
        SITE_URL: origin,
        S3_ENDPOINT: config.s3.endpoint,
        S3_PUBLIC_ENDPOINT: config.s3.publicEndpoint,
        S3_BUCKET: config.s3.bucket,
        S3_REGION: config.s3.region,
        S3_ACCESS_KEY_ID: config.s3.accessKeyId,
        S3_SECRET_ACCESS_KEY: config.s3.secretAccessKey,
        GITHUB_APP_CLIENT_ID: GITHUB_APP.clientId,
        GITHUB_APP_CLIENT_SECRET: GITHUB_APP.clientSecret,
        GITHUB_APP_SLUG: GITHUB_APP.slug,
    };
    if (config.oauthClientId !== null) env['SUPABASE_OAUTH_CLIENT_ID'] = config.oauthClientId;
    Object.assign(env, extraEnv);
    const child = spawn(process.execPath, [vite, 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    let exited: number | null | undefined;
    const gone = new Promise<void>(resolve => child.once('exit', code => ((exited = code), resolve())));

    const stop = async (): Promise<void> => {
        if (exited === undefined) {
            child.kill('SIGTERM');
            await gone;
        }
    };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (exited !== undefined) throw new Error(`the app exited (${String(exited)}) before it answered:\n${output}`);
        const answered = await fetch(`${origin}/auth/login`).then(
            r => r.status,
            () => null,
        );
        if (answered === 200) return { origin, stop };
        await new Promise(r => setTimeout(r, 250));
    }
    await stop();
    throw new Error(`the app did not answer ${origin}/auth/login within ${timeoutMs} ms:\n${output}`);
}
