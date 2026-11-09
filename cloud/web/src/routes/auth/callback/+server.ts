import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { landing } from '#lib/login.ts';
import { report } from '#lib/report.ts';

/** Where Auth sends the browser back after a GitHub login: trades `code`
 *  for a session in this request's cookies (Auth checks the PKCE verifier
 *  cookie @supabase/ssr set when the login began), then a 303 to `next` if
 *  `landing` accepts it, else to `/`. No code, or one Auth refuses, is a
 *  303 to the login page, and a refusal is reported.
 *
 *  One of the two GETs with a side effect that cloud/CLAUDE.md allows: the
 *  session it sets is in `__Host-` cookies, which only this host can set. */
export const GET: RequestHandler = async ({ url, locals }) => {
    const code = url.searchParams.get('code');
    const next = landing(url.searchParams.get('next'));
    if (code === null) redirect(303, '/auth/login');
    const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
    if (error !== null) {
        report('callback', error.message);
        redirect(303, '/auth/login');
    }
    redirect(303, next);
};
