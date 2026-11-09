// What the local Supabase stack reports about itself, for the other scripts.
import { execFileSync } from 'node:child_process';

/**
 * Returns `supabase status -o json`, parsed: the stack's URLs and keys as it
 * reports them from wherever this runs. Throws when the stack is not running.
 *
 * On Windows `pnpm` is `pnpm.cmd`, which only a shell runs; the arguments
 * are fixed, so running them through one quotes nothing that varies. Each
 * script used to spawn `pnpm` itself, and all but one failed on Windows with
 * ENOENT.
 *
 * @returns {Record<string, string>} keys as the Supabase CLI names them (`API_URL`, `PUBLISHABLE_KEY`, ...)
 */
export function stackStatus() {
    return JSON.parse(
        execFileSync('pnpm', ['--filter', '@yukibana/cloud-db', 'exec', 'supabase', 'status', '-o', 'json'], {
            encoding: 'utf8',
            shell: process.platform === 'win32',
        }),
    );
}
