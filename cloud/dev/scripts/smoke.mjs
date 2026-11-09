// Proves the local stack is reachable from wherever this runs: Supabase's
// API and edge runtime (and so the cloud/db/supabase/functions bind mount), and the
// bucket. Deliberately no app schema dependency.
//
//   pnpm --filter @yukibana/cloud-dev smoke
import { stackStatus } from './stack.mjs';

const s = stackStatus();
const url = process.env.SUPABASE_URL ?? s.API_URL;
const key = process.env.SUPABASE_ANON_KEY ?? s.PUBLISHABLE_KEY ?? s.ANON_KEY;
if (key === undefined) {
    console.error('The stack reports no publishable key; set SUPABASE_ANON_KEY.');
    process.exit(1);
}
const host = process.env.SUPABASE_SERVICES_HOSTNAME ?? '127.0.0.1';
const bucket = process.env.S3_ENDPOINT ?? `http://${host}:9000`;
console.log(`Checking ${url} and ${bucket}`);

let failed = false;
/**
 * Fetches `target` and prints whether `ok` holds for the answer, under `name`, or why it could not be fetched.
 *
 * @param {string} name
 * @param {string} target
 * @param {RequestInit} [init]
 * @param {(res: Response) => boolean} [ok]
 */
const check = async (name, target, init = {}, ok = res => res.ok) => {
    try {
        const res = await fetch(target, init);
        if (!ok(res)) {
            throw new Error(`HTTP ${res.status}`);
        }
        console.log(`OK   ${name}`);
    } catch (e) {
        // The URL, always: "fetch failed" on its own says nothing about which
        // host was unreachable, and the host is the thing that differs between
        // a laptop, a devcontainer and a runner.
        console.error(`FAIL ${name}: ${target}: ${e instanceof Error ? e.message : String(e)}`);
        failed = true;
    }
};
const auth = { headers: { apikey: key, Authorization: `Bearer ${key}` } };

await check('rest api', `${url}/rest/v1/`, auth); // Kong -> PostgREST -> Postgres
await check('auth', `${url}/auth/v1/health`, auth); // GoTrue
await check('edge function', `${url}/functions/v1/health`, auth);
// An unsigned request is refused, which is the bucket saying hello.
await check('bucket', `${bucket}/yukibana-cloud`, { method: 'HEAD' }, res => res.status === 403 || res.status === 200);

process.exit(failed ? 1 : 0);
