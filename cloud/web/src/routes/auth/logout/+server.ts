import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { landing } from '#lib/login.ts';
import { text } from '#lib/server/form.ts';
import { workerConfig } from '#lib/server/worker.ts';
import { githubFor } from '#lib/server/github-link.ts';
import { GITHUB_COOKIE, GITHUB_STATE_COOKIE, openToken } from '#lib/server/github-cookie.ts';
import { GitHubError } from '#lib/server/github.ts';
import { report } from '#lib/report.ts';

/** Logs this browser out of the website, then redirects (303) to the form's `next`, a path on this site, or to `/` without one. A POST, and so
 *  refused by `forgery` unless it is a form this site's own pages sent: a logout another page can trigger is a nuisance a sibling could cause.
 *  The invite page sends `next` to switch accounts: log out, then log in again and come back to the invite.
 *
 *  It also ends a GitHub connection in this browser: a token cookie sealed for the person logging out is revoked on GitHub (best effort, reported
 *  when GitHub refuses), and both GitHub cookies are deleted whatever they hold, so the next person to sign in here starts with none. */
export const POST: RequestHandler = async ({ locals, request, cookies }) => {
    const next = landing(text(await request.formData(), 'next'));
    const app = workerConfig().github;
    const held = cookies.get(GITHUB_COOKIE);
    if (app !== null && held !== undefined && locals.claims !== null) {
        const { github, key } = await githubFor(app);
        const token = await openToken(held, locals.claims.sub, key, new Date());
        if (token !== null) {
            try {
                await github.revokeToken(token);
            } catch (e) {
                if (!(e instanceof GitHubError)) throw e;
                report('github', `revoking a token at logout: ${e.message}`);
            }
        }
    }
    cookies.delete(GITHUB_COOKIE, { path: '/' });
    cookies.delete(GITHUB_STATE_COOKIE, { path: '/' });
    // This browser only: the IDE's and the CLI's sessions are their own, and
    // so are the person's other browsers.
    await locals.supabase.auth.signOut({ scope: 'local' });
    redirect(303, next);
};
