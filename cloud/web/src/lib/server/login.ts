/** Logging in by a code mailed to the address.
 *
 *  Supabase Auth does all of it: these two calls are here so the login page
 *  and the integration suite run the same code, and so what a failure tells
 *  the person is decided once. Nothing here touches the database: the
 *  account, its profile and its enrolments follow from `auth.users`, through
 *  the trigger in the courses migration.
 */

import { trustId, type UserId } from '#lib/ids.ts';
import { addressOf } from '#lib/login.ts';
import { report } from '#lib/report.ts';
import type { Supabase } from '#lib/server/session.ts';

/** The two calls of a Supabase Auth client this needs, so a test can pass
 *  a client of its own. */
export type CodeAuth = Pick<Supabase['auth'], 'signInWithOtp' | 'verifyOtp'>;

/** A refusal, for the page to show. */
export type Refused = {
    /** Always `false`. */
    readonly ok: false;
    /** The HTTP status the page answers with: 400 for a code that does not
     *  work, 429 when Auth is rate limiting, 502 when Auth failed. */
    readonly status: number;
    /** What the page shows: for 400 and 429 a sentence written for the
     *  person; for 502 the line `report` logged (`login: could not send…`),
     *  which quotes Auth's error and the address the person typed. */
    readonly message: string;
};

/** Throws a TypeError unless `email` is already as `addressOf` writes it. */
function requireAddress(email: string, where: string): void {
    if (addressOf(email) !== email) throw new TypeError(`${where}: the address is not trimmed, lowercased and of one @ (pass it through addressOf)`);
}

/** Mails a code to `email`, creating the account if the address has none.
 *  Anyone may ask: an account with no enrolment sees nothing, and an
 *  address that already has an account (from GitHub) gets a code for that
 *  one. A new account is unconfirmed until its code is verified
 *  (`enable_confirmations` in cloud/db/supabase/config.toml), so asking for a code
 *  for someone else's address links nothing.
 *
 *  - Requires: `email` is what `addressOf` returns for it; throws a
 *    TypeError otherwise, because an address spelled another way would not
 *    be the one `enrollment` holds. */
export async function sendCode(auth: CodeAuth, email: string): Promise<{ readonly ok: true } | Refused> {
    requireAddress(email, 'sendCode');
    const { error } = await auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error === null) return { ok: true };
    if (error.status === 429) return { ok: false, status: 429, message: 'Too many codes asked for just now. Wait a minute and try again.' };
    return { ok: false, status: 502, message: report('login', `could not send a code to ${email}: ${error.message}`) };
}

/** Turns the code into a session on `auth`'s client, which for the page is
 *  this request's cookies, and returns whose it is. A code works once.
 *  Wrong and expired are one answer, a 400: Auth does not tell them apart,
 *  and neither should a guesser; so is any other failure of Auth's, which
 *  is not reported.
 *
 *  - Requires: `email` is what `addressOf` returns for it, the address the
 *    code was sent to; throws a TypeError otherwise. `code` is passed to
 *    Auth as it is (`codeOf` tidies what a person typed). */
export async function verifyCode(auth: CodeAuth, email: string, code: string): Promise<{ readonly ok: true; readonly userId: UserId } | Refused> {
    requireAddress(email, 'verifyCode');
    const { data, error } = await auth.verifyOtp({ email, token: code, type: 'email' });
    if (error === null && data.user !== null) return { ok: true, userId: trustId<UserId>(data.user.id) };
    return { ok: false, status: 400, message: 'That code is wrong or has expired. Ask for a new one.' };
}
