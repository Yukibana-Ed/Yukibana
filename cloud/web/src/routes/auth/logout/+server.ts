import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Logs this browser out of the website, then a 303 to `/`. A POST, and
 *  so refused by `forgery` unless it is a form this site's own pages sent:
 *  a logout another page can trigger is a nuisance a sibling could cause. */
export const POST: RequestHandler = async ({ locals }) => {
    // This browser only: the IDE's and the CLI's sessions are their own, and
    // so are the person's other browsers.
    await locals.supabase.auth.signOut({ scope: 'local' });
    redirect(303, '/');
};
