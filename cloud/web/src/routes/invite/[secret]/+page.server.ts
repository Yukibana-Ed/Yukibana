import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { asUser, refusalOf } from '#lib/server/db.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { acceptInvite, inviteStatus, type InviteStatus } from '#lib/server/invites.ts';
import { inviteSecretOf } from '#lib/invite.ts';

/** The secret in the address, or a 404 for anything not shaped like one: a
 *  link cut short in a mail is told so without asking the database. */
function secretOf(params: { readonly secret: string }): string {
    return inviteSecretOf(params.secret) ?? error(404, 'That is not a whole invite link. Check that it was copied to the end.');
}

/** An invite link, opened. Reads only, like every load (a page on a
 *  sibling subdomain can make a browser GET this with its cookies): it says
 *  what accepting would do, and the one write is the `accept` form.
 *
 *  For someone signed out, `{ signedIn: false }`, and the page sends them to
 *  log in, or to make an account, and back here. For someone signed in,
 *  `status` (`open`, `expired`, or `unknown` for an invite used, removed or
 *  never made) and their platform `role`, so the page can say before they
 *  press anything that a teacher or an admin has nothing to accept. */
export const load: PageServerLoad = async ({ locals, params }) => {
    const secret = secretOf(params);
    const claims = locals.claims;
    if (claims === null) return { signedIn: false as const };
    return withContext(ctx =>
        asUser(ctx.sql, claims, async tx => {
            const status: InviteStatus = await inviteStatus(tx, secret);
            const [me] = await tx<{ role: string | null }[]>`select app.platform_role()::text as role`;
            return { signedIn: true as const, status, role: me?.role ?? null, email: claims.email ?? 'this account' };
        }),
    );
};

export const actions: Actions = {
    /** The signed-in person accepts the invite through
     *  `app.redeem_teacher_invite`, which makes a plain user a teacher and
     *  deletes the invite in one transaction. Answers `{ accepted: true }`,
     *  or a `fail` with the database's status and sentence: 403 for someone
     *  already a teacher or an admin, or an expired invite; 404 for one used
     *  or removed. Anything else is a 500 with a fixed sentence, reported
     *  (`refusalOf`). */
    accept: async event => {
        const claims = requireClaims(event);
        const secret = secretOf(event.params);
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => acceptInvite(tx, secret)));
        } catch (e) {
            const { status, message } = refusalOf('invite', e);
            return fail(status, { error: message });
        }
        return { accepted: true };
    },
};
