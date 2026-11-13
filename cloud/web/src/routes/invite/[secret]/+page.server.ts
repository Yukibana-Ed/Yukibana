import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { asUser, refusalOf } from '#lib/server/db.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { inviteHash, inviteSecretOf } from '#lib/invite.ts';

/** Returns the secret in the address, or answers 404 when it does not have a secret's shape, as with a link cut short in an email. */
function secretOf(params: { readonly secret: string }): string {
    return inviteSecretOf(params.secret) ?? error(404, 'This is not a complete invite link. Check that it was copied to the end.');
}

/** The invite page. Returns `{ account: null }` for a visitor who is not signed in; otherwise their `account` (address and platform role) and
 *  `open`, `true` iff the invite is still unused. Only reads, like every load: the one write is the `accept` form. */
export const load: PageServerLoad = async ({ locals, params }) => {
    const secret = secretOf(params);
    const claims = locals.claims;
    if (claims === null) return { account: null, open: false };
    const hash = await inviteHash(secret);
    const [row] = await withContext(ctx =>
        asUser(
            ctx.sql,
            claims,
            tx => tx<{ role: 'user' | 'teacher' | 'admin'; open: boolean }[]>`
            select app.platform_role()::text as role, app.teacher_invite_exists(${hash}) as open`,
        ),
    );
    if (row === undefined) throw new Error('the invite query returned no row');
    return { account: { email: claims.email ?? 'this account', role: row.role }, open: row.open };
};

export const actions: Actions = {
    /** Accepts the invite for the signed-in account through `app.redeem_teacher_invite`, which makes it a teacher and deletes the invite.
     *  Answers `{ accepted: true }`, or a `fail` with the database's status and sentence: 403 for an account that already has teacher rights,
     *  404 for an invite already accepted or removed. Any other failure is a 500 with a fixed sentence, and is reported (`refusalOf`). */
    accept: async event => {
        const claims = requireClaims(event);
        const hash = await inviteHash(secretOf(event.params));
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.redeem_teacher_invite(${hash})`));
        } catch (e) {
            const { status, message } = refusalOf('invite', e);
            return fail(status, { error: message });
        }
        return { accepted: true };
    },
};
