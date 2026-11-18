import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { workerConfig } from '#lib/server/worker.ts';
import { githubFor, returned } from '#lib/server/github-link.ts';
import { GITHUB_COOKIE, GITHUB_COOKIE_OPTIONS, GITHUB_STATE_COOKIE } from '#lib/server/github-cookie.ts';

/** Where GitHub sends the browser back after Connect GitHub, or after the
 *  App's installation with "Request user authorization during
 *  installation" on: the App's callback URL. `returned` decides
 *  (#lib/server/github-link). A return that is not this browser's
 *  connection, for this person, is refused before GitHub is asked anything
 *  and deletes no cookie; one with no connection in flight is sent to a page
 *  saying the App is installed.
 *
 *  One of the GETs with a side effect that cloud/CLAUDE.md bounds, as
 *  `/auth/callback` is: its one effect is a `__Host-` cookie only this host
 *  can set, and only for the state this browser's own `?/connectGithub`
 *  sealed. A 404 where the GitHub App is not configured. */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
    const app = workerConfig().github;
    if (app === null) error(404, 'This registry does not link projects to GitHub.');
    const { github, key } = await githubFor(app);
    const decided = await returned({ query: url.searchParams, stateCookie: cookies.get(GITHUB_STATE_COOKIE), sub: locals.claims?.sub ?? null, key, github, now: new Date() });
    if (decided.kind === 'installed') redirect(303, '/auth/github/installed');
    if (decided.kind === 'refused') error(decided.status, decided.message);
    cookies.delete(GITHUB_STATE_COOKIE, { path: '/' });
    if (decided.kind === 'failed') error(decided.status, decided.message);
    cookies.set(GITHUB_COOKIE, decided.cookie, GITHUB_COOKIE_OPTIONS);
    redirect(303, decided.to);
};
