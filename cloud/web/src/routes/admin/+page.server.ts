import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { asUser, refusalOf } from '#lib/server/db.ts';
import { text, uuidIn } from '#lib/server/form.ts';
import { inviteLink } from '#lib/invite.ts';
import type { InviteId } from '#lib/ids.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';

/** Platform roles. The one thing an admin does here is make teachers, by address or by invite link.
 *  Returns everyone whose platform role is not `user`, every unused invite (newest first, with the name of the admin who created it, or null
 *  when their profile has none), and the newest 50 rows of the audit log with each `subject` as JSON text. A 403 for
 *  anyone but an admin, decided by `app.is_admin`; the login page for
 *  nobody. */
export const load: PageServerLoad = async event => {
    const claims = requireClaims(event);
    return withContext(ctx =>
        asUser(ctx.sql, claims, async tx => {
            const [me] = await tx<{ admin: boolean }[]>`select app.is_admin() as admin`;
            if (me?.admin !== true) error(403, 'Admins only.');
            const staff = await tx<{ user_id: string; full_name: string | null; github_login: string | null; role: string }[]>`
        select user_id, app.visible_name(user_id) as full_name, github_login, role::text as role from app_user where role <> 'user' order by role, github_login`;
            const invites = await tx<{ invite_id: InviteId; label: string; created_by: string | null; created_at: Date }[]>`
        select i.invite_id, i.label, coalesce(app.visible_name(u.user_id), u.github_login) as created_by, i.created_at
          from teacher_invite i join app_user u on u.user_id = i.created_by
         order by i.created_at desc`;
            const audit = await tx<{ at: Date; actor: string | null; action: string; subject: unknown }[]>`
        select at, actor, action, subject from audit_log order by at desc limit 50`;
            return { staff, invites, audit: audit.map(a => ({ at: a.at, actor: a.actor, action: a.action, subject: JSON.stringify(a.subject) })) };
        }),
    );
};

/** The admin page's forms. */
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

    /** Creates an invite labelled `label` through `app.create_teacher_invite`, which refuses anyone but an admin. Answers
     *  `{ invite: { label, link } }`, where `link` carries the secret, shown this once and stored nowhere; or a `fail` as `setRole` does. */
    createInvite: async event => {
        const claims = requireClaims(event);
        const label = text(await event.request.formData(), 'label');
        try {
            const [row] = await withContext(ctx => asUser(ctx.sql, claims, tx => tx<{ secret: string }[]>`select app.create_teacher_invite(${label}) as secret`));
            if (row === undefined) throw new Error('app.create_teacher_invite returned no row');
            return { invite: { label, link: inviteLink(event.url.origin, row.secret) } };
        } catch (e) {
            const { status, message } = refusalOf('admin', e);
            return fail(status, { error: message });
        }
    },

    /** Removes the unused invite `invite_id` through `app.revoke_teacher_invite`, which refuses anyone but an admin, so that its link stops
     *  working. Answers `{ ok: true }`; a 400 when `invite_id` is missing or not a uuid; or a `fail` as `setRole` does, a 404 for an invite
     *  already accepted or removed. */
    revokeInvite: async event => {
        const claims = requireClaims(event);
        const invite = uuidIn<InviteId>(await event.request.formData(), 'invite_id');
        if (invite === null) return fail(400, { error: 'No invite was named.' });
        try {
            await withContext(ctx => asUser(ctx.sql, claims, tx => tx`select app.revoke_teacher_invite(${invite})`));
        } catch (e) {
            const { status, message } = refusalOf('admin', e);
            return fail(status, { error: message });
        }
        return { ok: true };
    },
};
