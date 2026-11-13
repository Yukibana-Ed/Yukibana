/** Invite links: the shape of their secret, the link that carries it, and the hash the database knows it by. */

import { sha256 } from '#lib/bytes.ts';

const SECRET = /^yk_invite_[0-9a-f]{64}$/;

/** Returns `value` if it has the shape of a secret from `app.create_teacher_invite` (`yk_invite_` and 64 lowercase hexadecimal digits), else
 *  null. Only the shape is checked; whether an invite has this secret is for the database to say. */
export function inviteSecretOf(value: string): string | null {
    return SECRET.test(value) ? value : null;
}

/** Returns the link to the invite page for `secret` on the site at `origin` (e.g. `https://cloud.yukibana.dev`, without a trailing slash).
 *
 *  - Requires: `inviteSecretOf(secret)` is `secret`; throws a TypeError otherwise. */
export function inviteLink(origin: string, secret: string): string {
    if (inviteSecretOf(secret) === null) throw new TypeError('inviteLink: not an invite secret');
    return `${origin}/invite/${secret}`;
}

/** Returns the SHA-256 of `secret`'s UTF-8 bytes, which is the only form of a secret the database stores or accepts. */
export async function inviteHash(secret: string): Promise<Uint8Array<ArrayBuffer>> {
    return (await sha256(new TextEncoder().encode(secret))) as Uint8Array<ArrayBuffer>;
}
