/** Teacher invites, as the database keeps them.
 *
 *  Every rule is in the migration (…_teacher_invites.sql): who may make,
 *  list, remove and accept an invite, that one works once, for a plain user
 *  only, and expires. These functions only carry a request to it, as the
 *  person asking, and hash the secret on the way: the database never sees
 *  a secret except the moment it makes one.
 */

import { sha256 } from '#lib/bytes.ts';
import { trustId, type InviteId, type UserId } from '#lib/ids.ts';
import type { Tx } from './db';

/** An unused invite, as an admin's list shows it. */
export interface Invite {
    /** Its id, for removing it. */
    readonly id: InviteId;
    /** Who the admin meant it for, as they wrote it; '' when they wrote nothing. */
    readonly label: string;
    /** The admin who made it. */
    readonly createdBy: UserId;
    /** Their display name, or their GitHub login, or null when the profile has neither. */
    readonly createdByName: string | null;
    readonly createdAt: Date;
    /** When it stops working: two weeks after `createdAt`. */
    readonly expiresAt: Date;
    /** Whether `expiresAt` had passed when the list was read, by the database's clock. */
    readonly expired: boolean;
}

/** What opening a link finds: `open` would work now; `expired` is listed
 *  but refused; `unknown` was used, removed, or never existed, which the
 *  database answers as one. */
export type InviteStatus = 'open' | 'expired' | 'unknown';

/** The secret's SHA-256 over its UTF-8 bytes, which is all the database keeps of it. */
async function hashOf(secret: string): Promise<Uint8Array<ArrayBuffer>> {
    return (await sha256(new TextEncoder().encode(secret))) as Uint8Array<ArrayBuffer>;
}

/** Makes an invite labelled `label` and returns its secret, which is stored
 *  nowhere: the caller shows it once, in a link, and forgets it. Throws the
 *  database's refusal (42501) unless `tx` is an admin's. */
export async function createInvite(tx: Tx, label: string): Promise<string> {
    const [row] = await tx<{ secret: string }[]>`select app.create_teacher_invite(${label}) as secret`;
    if (row === undefined) throw new Error('app.create_teacher_invite returned no row');
    return row.secret;
}

/** Every unused invite, expired ones included, newest first. Empty for
 *  anyone but an admin: the policy shows them nothing, it does not refuse. */
export async function listInvites(tx: Tx): Promise<Invite[]> {
    const rows = await tx<
        { invite_id: string; label: string; created_by: string; name: string | null; created_at: Date; expires_at: Date; expired: boolean }[]
    >`select i.invite_id, i.label, i.created_by, coalesce(u.full_name, u.github_login) as name, i.created_at, i.expires_at, i.expires_at <= now() as expired
        from teacher_invite i left join app_user u on u.user_id = i.created_by
       order by i.created_at desc, i.invite_id desc`;
    return rows.map(r => ({
        id: trustId<InviteId>(r.invite_id),
        label: r.label,
        createdBy: trustId<UserId>(r.created_by),
        createdByName: r.name,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        expired: r.expired,
    }));
}

/** Removes the unused invite `id`, so its link stops working. Throws the
 *  database's refusal: 42501 unless `tx` is an admin's, P0002 when it was
 *  used or removed already. */
export async function revokeInvite(tx: Tx, id: InviteId): Promise<void> {
    await tx`select app.revoke_teacher_invite(${id})`;
}

/** What the invite with `secret` would do if accepted now. Reads only. */
export async function inviteStatus(tx: Tx, secret: string): Promise<InviteStatus> {
    const [row] = await tx<{ status: InviteStatus }[]>`select app.teacher_invite_status(${await hashOf(secret)}) as status`;
    if (row === undefined) throw new Error('app.teacher_invite_status returned no row');
    return row.status;
}

/** `tx`'s person accepts the invite with `secret`: they become a teacher and
 *  the invite is gone, or nothing changes and the database's refusal is
 *  thrown: 42501 for a caller who is already a teacher or an admin, or an
 *  invite that expired; P0002 for one used, removed, or never made. */
export async function acceptInvite(tx: Tx, secret: string): Promise<void> {
    await tx`select app.redeem_teacher_invite(${await hashOf(secret)})`;
}
