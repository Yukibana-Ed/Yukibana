import { test, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asUser, connect, statusOf, type Tx } from '../../src/lib/server/db.js';
import { inviteHash, inviteLink } from '../../src/lib/invite.js';
import { SESSION_COOKIE } from '../../src/lib/session-cookie.js';
import { TEACHER, claimsOf, config } from './env.js';
import { codeMailedTo } from './mail.js';
import { startApp, type App } from './app.js';

// A local database has no admin until its developer makes themselves one, so this suite makes a throwaway account an admin with the seed's
// `tests.set_platform_role` and demotes it at the end, which leaves `app.bootstrap_admin` to the developer.

const sql = connect(config.databaseUrl);
const ADMIN = `invite-admin-${randomUUID()}@example.com`;
let app: App;

/** Returns an address no earlier run has used, so that a test never meets another run's account or email. */
const fresh = (): string => `invitee-${randomUUID()}@example.com`;

/** Runs `run` as the seeded teacher, who can call the seed's helpers like anyone. */
const asTeacher = <T>(run: (tx: Tx) => Promise<T>): Promise<T> => asUser(sql, claimsOf(TEACHER), run);

/** Creates an account for `addr`, as Auth does at a first login. */
const account = (addr: string): Promise<unknown> => asTeacher(tx => tx`select tests.create_user(${addr})`);

/** Returns a new invite's secret, created by the suite's admin. */
async function invite(label: string): Promise<string> {
    const [row] = await asUser(sql, claimsOf(ADMIN), tx => tx<{ secret: string }[]>`select app.create_teacher_invite(${label}) as secret`);
    if (row === undefined) throw new Error('no secret returned');
    return row.secret;
}

/** Returns `true` iff an unused invite has `secret`. */
async function exists(secret: string): Promise<boolean> {
    const hash = await inviteHash(secret);
    const [row] = await asUser(sql, claimsOf(ADMIN), tx => tx<{ open: boolean }[]>`select app.teacher_invite_exists(${hash}) as open`);
    return row?.open === true;
}

/** Accepts the invite with `secret` as `addr`, returning the status and SQLSTATE of the refusal, or `null` when it was accepted. */
async function accept(addr: string, secret: string): Promise<{ status: number; code: string } | null> {
    const hash = await inviteHash(secret);
    try {
        await asUser(sql, claimsOf(addr), tx => tx`select app.redeem_teacher_invite(${hash})`);
        return null;
    } catch (e) {
        const { status, code } = statusOf(e);
        return { status, code };
    }
}

/** Returns the platform role of `addr`'s account. */
async function roleOf(addr: string): Promise<string | undefined> {
    const [row] = await asUser(sql, claimsOf(addr), tx => tx<{ role: string }[]>`select app.platform_role()::text as role`);
    return row?.role;
}

beforeAll(async () => {
    await account(ADMIN);
    await asTeacher(tx => tx`select tests.set_platform_role(${ADMIN}, 'admin')`);
    app = await startApp();
}, 120_000);

afterAll(async () => {
    await app?.stop();
    await asUser(sql, claimsOf(ADMIN), tx => tx`select app.revoke_teacher_invite(invite_id) from teacher_invite where created_by = ${claimsOf(ADMIN).sub}`);
    await asTeacher(tx => tx`select tests.set_platform_role(${ADMIN}, 'user')`);
    await sql.end({ timeout: 5 });
});

test('one invite link makes a teacher of every plain user who accepts it, until an admin removes it', async () => {
    const secret = await invite('a whole faculty');
    const [first, second, late] = [fresh(), fresh(), fresh()];
    await account(first);
    await account(second);
    await account(late);
    expect(await accept(first, secret)).toBeNull();
    expect(await accept(second, secret)).toBeNull();
    expect(await roleOf(first)).toBe('teacher');
    expect(await roleOf(second)).toBe('teacher');

    const [row] = await asUser(
        sql,
        claimsOf(ADMIN),
        tx => tx<{ invite_id: string; uses: number }[]>`
        select invite_id, uses::int as uses from teacher_invite where label = 'a whole faculty' and created_by = ${claimsOf(ADMIN).sub}`,
    );
    if (row === undefined) throw new Error('the invite is not listed');
    expect(row.uses).toBe(2);
    await asUser(sql, claimsOf(ADMIN), tx => tx`select app.revoke_teacher_invite(${row.invite_id})`);
    expect(await accept(late, secret)).toEqual({ status: 404, code: 'P0002' });
    expect(await roleOf(late)).toBe('user');
    expect(await roleOf(first)).toBe('teacher');
});

test('a teacher can neither create nor see invites, and accepting one changes nothing for them', async () => {
    const secret = await invite('for someone else');
    await expect(asTeacher(tx => tx`select app.create_teacher_invite('mine')`)).rejects.toMatchObject({ code: '42501' });
    expect(await asTeacher(tx => tx`select 1 from teacher_invite`)).toHaveLength(0);
    expect(await accept(TEACHER, secret)).toBeNull();
    expect(await roleOf(TEACHER)).toBe('teacher');
    expect(await accept(ADMIN, secret)).toBeNull();
    expect(await roleOf(ADMIN)).toBe('admin');
    expect(await exists(secret)).toBe(true);
});

// Through the app, as a browser: someone with no account opens the link, creates an account by the code emailed to them, and accepts.

/** Returns the request a form of this site's own pages sends, as a browser does without JavaScript. */
const ownForm = (fields: Record<string, string>, cookie = ''): RequestInit => ({
    method: 'POST',
    redirect: 'manual',
    headers: { origin: app.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', cookie },
    body: new URLSearchParams(fields),
});

/** Creates an account for `addr` through the login page, and returns its session cookies as a `cookie` header. */
async function signUp(addr: string, next: string): Promise<string> {
    const since = Date.now();
    const sent = await fetch(`${app.origin}/auth/login?/send`, ownForm({ email: addr, next }));
    expect(sent.status, await sent.clone().text()).toBe(200);
    const verified = await fetch(`${app.origin}/auth/login?/verify`, ownForm({ email: addr, code: await codeMailedTo(addr, since), next }));
    expect(verified.headers.get('location')).toBe(next);
    return verified.headers
        .getSetCookie()
        .map(line => line.split(';')[0] ?? '')
        .filter(pair => pair.startsWith(SESSION_COOKIE) && !pair.endsWith('='))
        .join('; ');
}

test('people without an account open the same invite link, sign up on the way, and each accept it to become a teacher', { timeout: 60_000 }, async () => {
    const link = inviteLink(app.origin, await invite('through the app'));
    const path = new URL(link).pathname;
    expect(await (await fetch(link)).text()).toContain(`/auth/login?next=${encodeURIComponent(path)}`);

    const cookie = await signUp(fresh(), path);
    expect(await (await fetch(link, { headers: { cookie } })).text()).toContain('Accept invite');
    const accepted = await fetch(`${link}?/accept`, ownForm({}, cookie));
    expect(await accepted.text()).toContain('a teacher now');
    expect(await (await fetch(link, { headers: { cookie } })).text()).toContain('You already have teacher rights');

    const another = await signUp(fresh(), path);
    expect(await (await fetch(`${link}?/accept`, ownForm({}, another))).text()).toContain('a teacher now');
});

test('switching accounts on an invite logs out and comes back to it through the login page', async () => {
    const r = await fetch(`${app.origin}/auth/logout`, ownForm({ next: '/auth/login?next=%2Finvite%2Fx' }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/auth/login?next=%2Finvite%2Fx');
});

test('a link cut short is not an invite', async () => {
    expect((await fetch(`${app.origin}/invite/yk_invite_0123`)).status).toBe(404);
});
