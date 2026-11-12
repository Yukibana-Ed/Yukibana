import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { asUser, refusalOf } from '#lib/server/db.ts';
import { text, uuidIn } from '#lib/server/form.ts';
import { createInvite, listInvites, revokeInvite } from '#lib/server/invites.ts';
import { inviteLink } from '#lib/invite.ts';
import type { InviteId } from '#lib/ids.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';

/** Platform roles. The one thing an admin does here is make teachers, by
 *  address or by invite link.
 *  Returns everyone whose platform role is not `user`, every unused invite
 *  (newest first, expired ones included and marked), and the newest 50
 *  rows of the audit log with each `subject` as JSON text. A 403 for
 *  anyone but an admin, decided by `app.is_admin`; the login page for
 *  nobody. */
export const load: PageServerLoad = async event => {
    const claims = requireClaims(event);
    return withContext(ctx =>
        asUser(ctx.sql, claims, async tx => {
            const [me] = await tx<{ admin: boolean }[]>`select app.is_admin() as admin`;
            if (me?.admin !== true) error(403, 'Admins only.');
            const staff = await tx<{ user_id: string; full_name: string | null; github_login: string | null; role: string }[]>`
        select user_id, full_name, github_login, role::text as role from app_user where role <> 'user' order by role, github_login`;
            const invites = await listInvites(tx);
            const audit = await tx<{ at: Date; actor: string | null; action: string; subject: unknown }[]>`
        select at, actor, action, subject from audit_log order by at desc limit 50`;
            return { staff, invites, audit: audit.map(a => ({ at: a.at, actor: a.actor, action: a.action, subject: JSON.stringify(a.subject) })) };
        }),
    );
};

/** The admin page's forms. Each answers a refusal with a `fail` carrying
 *  the database's status and sentence, or a 500 with a fixed sentence for
 *  anything else, reported and not shown (`refusalOf`). */
export const actions: Actions = {
    /** Gives the account with address `email` the platform role `role`
     *  (`user`, `teacher` or `admin`; anything else is a 400) through
     *  `app.set_platform_role_by_email`, which checks that the caller is an
     *  admin and audits. Answers `{ ok: true }`, or a `fail` with the
     *  database's status and sentence for a refusal (a 403 for a caller who
     *  is not an admin, a 404 for an address no account has logged in with
     *  yet), or a 500 with a fixed sentence for anything else, reported and
     *  not shown (`refusalOf`). */
    setRole: async event => {
        const claims = requireClaims(event);
        const form = await event.request.formData();
        const email = text(form, 'email');
        const role = text(form, 'role');
        if (!['user', 'teacher', 'admin'].includes(role)) return fail(400, { error: 'Unknown role.' });
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.set_platform_role_by_email(${email}, ${role}::app.platform_role)`));
        } catch (e) {
            const { status, message } = refusalOf('admin', e);
            return fail(status, { error: message });
        }
        return { ok: true };
    },

    /** Makes an invite link labelled `label` (trimmed, at most 200
     *  characters; longer is a 400) through `app.create_teacher_invite`,
     *  admins only. Answers `{ invite: { label, link } }`: the link carries
     *  the secret, which is shown this once and stored nowhere. */
    createInvite: async event => {
        const claims = requireClaims(event);
        const label = text(await event.request.formData(), 'label');
        if (label.length > 200) return fail(400, { error: 'A label is at most 200 characters.' });
        try {
            const secret = await withContext(ctx => asUser(ctx.sql, claims, tx => createInvite(tx, label)));
            return { invite: { label, link: inviteLink(event.url.origin, secret) } };
        } catch (e) {
            const { status, message } = refusalOf('admin', e);
            return fail(status, { error: message });
        }
    },

    /** Removes the unused invite `invite_id` through
     *  `app.revoke_teacher_invite`, admins only, so its link stops working.
     *  An id that is not a uuid is a 400; one that was used or removed
     *  already is a 404. Answers `{ ok: true }`. */
    revokeInvite: async event => {
        const claims = requireClaims(event);
        const invite = uuidIn<InviteId>(await event.request.formData(), 'invite_id');
        if (invite === null) return fail(400, { error: 'Which invite? None was named.' });
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => revokeInvite(tx, invite)));
        } catch (e) {
            const { status, message } = refusalOf('admin', e);
            return fail(status, { error: message });
        }
        return { ok: true };
    },
};
