import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { landing } from '#lib/login.ts';
import { text } from '#lib/server/form.ts';

/** Logs this browser out of the website, then redirects (303) to the form's `next`, a path on this site, or to `/` without one. A POST, and so
 *  refused by `forgery` unless it is a form this site's own pages sent: a logout another page can trigger is a nuisance a sibling could cause.
 *  The invite page sends `next` to switch accounts: log out, then log in again and come back to the invite. */
export const POST: RequestHandler = async ({ locals, request }) => {
    const next = landing(text(await request.formData(), 'next'));
    // This browser only: the IDE's and the CLI's sessions are their own, and
    // so are the person's other browsers.
    await locals.supabase.auth.signOut({ scope: 'local' });
    redirect(303, next);
};
