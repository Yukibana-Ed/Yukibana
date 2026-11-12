/** What an invite link looks like, decided once for the page that makes
 *  links and the page that opens them. */

/** The path every invite link starts with. */
export const INVITE_PATH = '/invite/';

const SECRET = /^yk_invite_[0-9a-f]{64}$/;

/** Returns `value` if it is shaped like the secret `app.create_teacher_invite`
 *  makes (`yk_invite_` and 64 lowercase hexadecimal digits), or null. The
 *  shape is all that is checked: whether an invite has that secret is the
 *  database's answer. A null lets a page refuse a mistyped or truncated link
 *  without asking anyone, and keeps anything else out of the hash. */
export function inviteSecretOf(value: string | null | undefined): string | null {
    return value !== null && value !== undefined && SECRET.test(value) ? value : null;
}

/** Returns the link that hands `secret` to whoever opens it, on the site at
 *  `origin` (`https://cloud.yukibana.dev`, no trailing slash).
 *
 *  - Requires: `secret` is what `inviteSecretOf` accepts; throws a TypeError
 *    otherwise, because a link to anything else could never be accepted. */
export function inviteLink(origin: string, secret: string): string {
    if (inviteSecretOf(secret) === null) throw new TypeError('inviteLink: not an invite secret');
    return `${origin}${INVITE_PATH}${secret}`;
}
