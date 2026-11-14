/** A person's own profile: the name they go by and who sees it and their picture. The database decides who sees what
 *  (`app.visible_name`, `profile_picture_read`); this reads the caller's own settings and saves them. */

import type { Claims } from '#lib/claims.ts';
import type { Audience } from '#lib/audience.ts';
import { asUser, type Tx } from './db';
import type { Context } from './context';

/** The caller's profile as they set it. */
export interface OwnProfile {
    /** The name they set, or the identity provider's until they set one; null for none. */
    readonly fullName: string | null;
    /** Their GitHub login, lowercased, or null when they did not log in with GitHub. Not theirs to change. */
    readonly githubLogin: string | null;
    /** Who sees their name and their picture. */
    readonly nameAudience: Audience;
    readonly pictureAudience: Audience;
}

/** Returns the caller's own profile, inside their transaction `tx`, or null when they have no profile row yet (the
 *  login trigger makes it, so only for a moment after an account is created). */
export async function ownProfile(tx: Tx, claims: Claims): Promise<OwnProfile | null> {
    const [u] = await tx<{ full_name: string | null; github_login: string | null; name_audience: Audience; picture_audience: Audience }[]>`
    select app.visible_name(user_id) as full_name, github_login, name_audience::text as name_audience, picture_audience::text as picture_audience
      from app_user where user_id = ${claims.sub}`;
    return u === undefined ? null : { fullName: u.full_name, githubLogin: u.github_login, nameAudience: u.name_audience, pictureAudience: u.picture_audience };
}

/** Sets the caller's name to `name` (trimmed; empty is none) and who sees it and their picture, through
 *  `app.set_profile`, which audits. Throws the database's error for a refusal: 42501 for a caller without a profile,
 *  23514 for a name over 100 characters. */
export async function saveProfile(ctx: Context, claims: Claims, name: string, nameAudience: Audience, pictureAudience: Audience): Promise<void> {
    await asUser(ctx.sql, claims, tx => tx`select app.set_profile(${name}, ${nameAudience}::app.profile_audience, ${pictureAudience}::app.profile_audience)`);
}
