/** The database, always as somebody.
 *
 *  The Worker connects as `yukibana_app`, a role that can read nothing and
 *  bypass nothing (supabase/migrations/…_connection_roles.sql). Every query
 *  runs inside `asUser` or `asPublisher`, which open a transaction and become
 *  the caller for its length, exactly as PostgREST would. So every policy in
 *  the migrations applies to every query here, and a query written outside
 *  these two functions fails with "permission denied" rather than answering
 *  as the owner.
 */

import { isHttpError } from '@sveltejs/kit';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { claimsJson, type Claims } from '#lib/claims.ts';
import { report } from '#lib/report.ts';

/** postgres.js's client, as `connect` returns it: one per request, closed
 *  by `withContext` after the response. Every query on it outside `asUser`
 *  or `asPublisher` runs as the connection's own role, `yukibana_app`, and
 *  fails with "permission denied"; that is the point. */
export type { Sql };
/** A transaction inside `asUser` or `asPublisher`, as the role they became.
 *  Valid only until `run` returns: a query on it afterwards fails. */
export type Tx = TransactionSql;

/** Returns a client of `url` for one request, connecting lazily (at the
 *  first query) with at most two connections, each given ten seconds to
 *  connect. The caller closes it (`withContext` does, after the response).
 *  Workers keep no state between requests, so the
 *  pool is per request and closed with the response; Hyperdrive holds the
 *  real connections. `fetch_types: false` saves a round trip we do not need,
 *  and `prepare: false` keeps a transaction-mode pooler honest. */
export function connect(url: string): Sql {
    return postgres(url, { max: 2, fetch_types: false, prepare: false, connect_timeout: 10 });
}

/** The Worker is connected to the database as the wrong role.
 *
 *  Not a policy refusing something: the connection itself cannot become the
 *  role a request has to run as, which no request will ever recover from.
 *  It is separate from every other database error because the answer is
 *  different — an operator has to change a connection string — and because
 *  it must not read to a caller like a denial. */
export class Misconfigured extends Error {}

/** Becomes `role` for the rest of the transaction, or says the connection is
 *  wrong.
 *
 *  `yukibana_app` is the only role that is a member of all three of `anon`,
 *  `authenticated` and `yukibana_publisher`, so it is the only connection
 *  the app works on. This existed to be caught: Hyperdrive was pointed at
 *  the connection string Supabase's dashboard offers, which is `postgres`.
 *  That role is a member of `authenticated` but not of `yukibana_publisher`,
 *  so every page worked and publishing a release answered 500 with nothing
 *  in it. Worse quietly: `postgres` owns the tables, and a table's owner is
 *  not subject to its policies unless they are forced, which the migrations
 *  deliberately do not do — so on that connection the authorisation model
 *  was off, and nothing said so. */
async function become(tx: Tx, role: string, claims: string): Promise<void> {
    try {
        await tx`select set_config('role', ${role}, true),
                    set_config('request.jwt.claims', ${claims}, true)`;
    } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        throw new Misconfigured(
            report('db', `the database connection cannot become ${role} (${why}); it must be the yukibana_app role, so check the user in the Hyperdrive configuration`),
        );
    }
}

/** Runs `run` in one transaction as the person the claims describe
 *  (`authenticated`, with `claims` as `request.jwt.claims`), commits, and
 *  returns what `run` returned. If `run` throws, the transaction is rolled
 *  back and the same value is thrown. Throws `Misconfigured` before `run`
 *  starts when the connection cannot become `authenticated`. */
export async function asUser<T>(sql: Sql, claims: Claims, run: (tx: Tx) => Promise<T>): Promise<T> {
    let result!: T;
    await sql.begin(async tx => {
        await become(tx, 'authenticated', claimsJson(claims));
        result = await run(tx);
    });
    return result;
}

/** Runs `run` in one transaction as the publisher: the role a request with
 *  a project token gets, which can turn that token into a release and read
 *  nothing at all. Commits and returns what `run` returned; rolls back and
 *  rethrows what it threw. `request.jwt.claims` is empty, so `auth.uid()`
 *  is null. Throws `Misconfigured` before `run` starts when the connection
 *  cannot become `yukibana_publisher`. */
export async function asPublisher<T>(sql: Sql, run: (tx: Tx) => Promise<T>): Promise<T> {
    let result!: T;
    await sql.begin(async tx => {
        await become(tx, 'yukibana_publisher', '');
        result = await run(tx);
    });
    return result;
}

/** Returns the HTTP status a database error deserves, for a route to
 *  answer with. A policy or a permission (42501) says 403; a function that
 *  raised P0002 says 404; a unique (23505), check (23514) or foreign key
 *  (23503) violation says 409; anything else, and anything that is not a
 *  database error, is the server's fault, 500. `message` is `e.message`
 *  for an Error, else `String(e)`. The message is the database's, which the migrations wrote as a
 *  sentence for exactly this purpose; `code` is the error's own `code` property as
 *  text, or '' when it has none: the SQLSTATE for an error the database
 *  raised, but postgres.js's own codes (`CONNECTION_CLOSED`,
 *  `CONNECT_TIMEOUT`) and system ones (`ECONNREFUSED`) come through the
 *  same way, so a caller may not assume five characters. It is the one
 *  part of an unexpected failure safe to put in a response. The message of a 500 is
 *  not: it may quote a query or a value, and is for the log. */
export function statusOf(e: unknown): { status: number; message: string; code: string } {
    const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
    const message = e instanceof Error ? e.message : String(e);
    switch (code) {
        case '42501':
            return { status: 403, message, code };
        case 'P0002':
            return { status: 404, message, code };
        case '23505':
        case '23514':
        case '23503':
            return { status: 409, message, code };
        default:
            return { status: 500, message, code };
    }
}

/** Returns the status and the sentence a form action may show the person
 *  for `e`, a failure of its database work, for `fail(status, { error })`.
 *  A refusal (any status `statusOf` gives other than 500) is the
 *  database's own sentence, which the migrations wrote for this. A 500 is
 *  reported under `where` and its message replaced by a fixed sentence
 *  carrying only the code, because that message may quote a query or a
 *  value (a course id that is not a uuid is a 22P02 that quotes it).
 *
 *  Throws `e` itself, rather than returning, when it is a SvelteKit HTTP
 *  error (already an answer) or `Misconfigured` (the connection's role,
 *  which the error hook answers in full for the operator). */
export function refusalOf(where: string, e: unknown): { status: number; message: string } {
    if (isHttpError(e) || e instanceof Misconfigured) throw e;
    const { status, message, code } = statusOf(e);
    if (status !== 500) return { status, message };
    report(where, message);
    return { status, message: `Something went wrong on the server${code === '' ? '' : ` (code ${code})`}; the Worker log says why.` };
}

/** Returns the unique constraint `e` broke, by name, or '' when `e` is anything
 *  else. Postgres's own sentence for a 23505 names an index
 *  (`duplicate key value violates unique constraint "course_code_key"`),
 *  which is no use to the person who typed the duplicate; a route that knows
 *  which constraint means which field says so in its own words instead.
 *  postgres.js carries the name as `constraint_name`. */
export function clashOf(e: unknown): string {
    if (statusOf(e).code !== '23505') return '';
    return typeof e === 'object' && e !== null && 'constraint_name' in e ? String(e.constraint_name) : '';
}
