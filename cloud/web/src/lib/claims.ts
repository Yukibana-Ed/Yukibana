/** What a verified session token says, reduced to what the database needs.
 *
 *  These are the claims `db.ts` sets as `request.jwt.claims` for the length
 *  of a request, and so what `auth.uid()` and every policy sees. They come
 *  from one place, the JWT the Auth server signed, checked in hooks.server.ts
 *  against its published keys. Nothing else is ever put in them: a claim the
 *  app made up would be a claim a policy might trust.
 */

import type { UserId } from './ids';
import { uuidOf } from './ids';

/** The claims of a logged-in person, as the database receives them.
 *
 *  Invariant: made only by `claimsOf`, from a token whose signature
 *  hooks.server.ts (through `identify`) has verified. */
export interface Claims {
    /** The person's id: `auth.users.id`, which is also their `app_user` row's
     *  `user_id`, and what `auth.uid()` returns inside `asUser`. */
    readonly sub: UserId;
    /** Always `authenticated`: an anonymous token is never made into claims. */
    readonly role: 'authenticated';
    /** The address the token carries, as Auth wrote it (not lowercased
     *  here), or null when the token carries none. Policies do not decide on
     *  it; enrolment matches addresses in the database. */
    readonly email: string | null;
}

/** Returns the claims in a verified token's payload, or null if it does
 *  not describe a logged-in person (an anonymous or malformed token: a
 *  `sub` that is not a uuid, or a `role` other than `authenticated`). An
 *  `email` that is not a string is null.
 *
 *  - Requires: the payload's signature has been verified. Not checked
 *    here, which only reads it: `Claims`' invariant rests on the caller. */
export function claimsOf(payload: { sub?: unknown; role?: unknown; email?: unknown }): Claims | null {
    const sub = typeof payload.sub === 'string' ? uuidOf<UserId>(payload.sub) : null;
    if (sub === null || payload.role !== 'authenticated') return null;
    return { sub, role: 'authenticated', email: typeof payload.email === 'string' ? payload.email : null };
}

/** Returns `claims` as the JSON `asUser` sets as `request.jwt.claims`:
 *  `sub`, `role`, and `email` only when it is not null (a missing key, not
 *  a JSON null, so `auth.jwt() ->> 'email'` reads as it would for a real
 *  token without one). */
export const claimsJson = (claims: Claims): string => JSON.stringify({ sub: claims.sub, role: claims.role, email: claims.email ?? undefined });
