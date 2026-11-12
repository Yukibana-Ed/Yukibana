import { test, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { asUser, connect, statusOf } from '../../src/lib/server/db.js';
import { acceptInvite, createInvite, inviteStatus, listInvites, revokeInvite } from '../../src/lib/server/invites.js';
import { inviteLink, inviteSecretOf } from '../../src/lib/invite.js';
import { SESSION_COOKIE } from '../../src/lib/session-cookie.js';
import { TEACHER, claimsOf, config } from './env.js';
import { codeMailedTo } from './mail.js';
import { startApp, type App } from './app.js';

// A local database has no admin until a developer makes themselves one, so
// this suite makes a throwaway account an admin (`tests.set_platform_role`,
// a seed helper) and lowers it again afterwards, leaving `bootstrap_admin`
// free for the developer.

const sql = connect(config.databaseUrl);
const ADMIN = `invite-admin-${randomUUID()}@example.com`;
let app: App;

/** An address no run has used, so a test never reads another's mail or meets another's account. */
const fresh = (): string => `invitee-${randomUUID()}@example.com`;

/** Makes an account for `addr` as Auth would after a login, through the seed's helper. */
async function account(addr: string): Promise<void> {
    await asUser(sql, claimsOf(TEACHER), tx => tx`select tests.create_user(${addr})`);
}

async function roleOf(addr: string): Promise<string | null> {
    const [row] = await asUser(sql, claimsOf(addr), tx => tx<{ role: string | null }[]>`select app.platform_role()::text as role`);
    return row?.role ?? null;
}

/** The status and SQLSTATE a refusal from `run` arrives with. */
async function refusal(run: () => Promise<unknown>): Promise<{ status: number; code: string }> {
    try {
        await run();
    } catch (e) {
        const { status, code } = statusOf(e);
        return { status, code };
    }
    throw new Error('expected a refusal');
}

beforeAll(async () => {
    await account(ADMIN);
    await asUser(sql, claimsOf(TEACHER), tx => tx`select tests.set_platform_role(${ADMIN}, 'admin')`);
    app = await startApp();
}, 120_000);

afterAll(async () => {
    await app?.stop();
    // Whatever this file left unused goes, and its admin is an admin no more.
    await asUser(sql, claimsOf(ADMIN), async tx => {
        for (const i of await listInvites(tx)) if (i.createdBy === claimsOf(ADMIN).sub) await revokeInvite(tx, i.id);
    });
    await asUser(sql, claimsOf(TEACHER), tx => tx`select tests.set_platform_role(${ADMIN}, 'user')`);
    await sql.end({ timeout: 5 });
});

test('an invite an admin makes turns one plain user into a teacher, once', async () => {
    const label = `for ${randomUUID()}`;
    const secret = await asUser(sql, claimsOf(ADMIN), tx => createInvite(tx, label));
    expect(inviteSecretOf(secret)).toBe(secret);
    const listed = await asUser(sql, claimsOf(ADMIN), tx => listInvites(tx));
    expect(listed.find(i => i.label === label)).toMatchObject({ createdBy: claimsOf(ADMIN).sub, expired: false });

    const first = fresh();
    const second = fresh();
    await account(first);
    await account(second);
    expect(await asUser(sql, claimsOf(first), tx => inviteStatus(tx, secret))).toBe('open');
    await asUser(sql, claimsOf(first), tx => acceptInvite(tx, secret));
    expect(await roleOf(first)).toBe('teacher');

    expect(await asUser(sql, claimsOf(second), tx => inviteStatus(tx, secret))).toBe('unknown');
    expect(await refusal(() => asUser(sql, claimsOf(second), tx => acceptInvite(tx, secret)))).toEqual({ status: 404, code: 'P0002' });
    expect(await roleOf(second)).toBe('user');
    expect((await asUser(sql, claimsOf(ADMIN), tx => listInvites(tx))).some(i => i.label === label)).toBe(false);
});

test('a teacher can neither make an invite nor see the ones that exist', async () => {
    const secret = await asUser(sql, claimsOf(ADMIN), tx => createInvite(tx, 'seen by admins only'));
    expect(await refusal(() => asUser(sql, claimsOf(TEACHER), tx => createInvite(tx, 'mine')))).toEqual({ status: 403, code: '42501' });
    expect(await asUser(sql, claimsOf(TEACHER), tx => listInvites(tx))).toEqual([]);
    const mine = (await asUser(sql, claimsOf(ADMIN), tx => listInvites(tx))).find(i => i.label === 'seen by admins only');
    if (mine === undefined) throw new Error('the admin does not see the invite they made');
    expect(await refusal(() => asUser(sql, claimsOf(TEACHER), tx => revokeInvite(tx, mine.id)))).toEqual({ status: 403, code: '42501' });
    // And a teacher who opens it does not spend it.
    expect(await refusal(() => asUser(sql, claimsOf(TEACHER), tx => acceptInvite(tx, secret)))).toEqual({ status: 403, code: '42501' });
    expect(await asUser(sql, claimsOf(ADMIN), tx => inviteStatus(tx, secret))).toBe('open');
});

test('a removed invite is gone from the list and its link no longer works', async () => {
    const secret = await asUser(sql, claimsOf(ADMIN), tx => createInvite(tx, 'to remove'));
    const it = (await asUser(sql, claimsOf(ADMIN), tx => listInvites(tx))).find(i => i.label === 'to remove');
    if (it === undefined) throw new Error('no invite listed');
    await asUser(sql, claimsOf(ADMIN), tx => revokeInvite(tx, it.id));
    expect((await asUser(sql, claimsOf(ADMIN), tx => listInvites(tx))).some(i => i.id === it.id)).toBe(false);
    expect(await refusal(() => asUser(sql, claimsOf(ADMIN), tx => revokeInvite(tx, it.id)))).toEqual({ status: 404, code: 'P0002' });
    const someone = fresh();
    await account(someone);
    expect(await refusal(() => asUser(sql, claimsOf(someone), tx => acceptInvite(tx, secret)))).toEqual({ status: 404, code: 'P0002' });
    expect(await roleOf(someone)).toBe('user');
});

// Through the app, as a browser: someone with no account opens the link,
// makes an account by the code mailed to them, and accepts.

/** A form this site's own page submits, as a browser does without JavaScript. */
const ownForm = (fields: Record<string, string>, cookie = ''): RequestInit => ({
    method: 'POST',
    redirect: 'manual',
    headers: { origin: app.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', cookie },
    body: new URLSearchParams(fields),
});

/** Makes an account for `addr` and logs it in through the app's login page, returning the session cookies. */
async function signUp(addr: string, next: string): Promise<string> {
    const since = Date.now();
    const sent = await fetch(`${app.origin}/auth/login?/send`, ownForm({ email: addr, next }));
    expect(sent.status, await sent.clone().text()).toBe(200);
    const verified = await fetch(`${app.origin}/auth/login?/verify`, ownForm({ email: addr, code: await codeMailedTo(addr, since), next }));
    expect(verified.status).toBe(303);
    expect(verified.headers.get('location')).toBe(next);
    return verified.headers
        .getSetCookie()
        .map(line => line.split(';')[0] ?? '')
        .filter(pair => pair.startsWith(SESSION_COOKIE) && !pair.endsWith('='))
        .join('; ');
}

test('someone without an account opens an invite link, signs up on the way, and accepts it to become a teacher', { timeout: 60_000 }, async () => {
    const secret = await asUser(sql, claimsOf(ADMIN), tx => createInvite(tx, 'through the app'));
    const link = inviteLink(app.origin, secret);
    const path = new URL(link).pathname;

    const signedOut = await fetch(link, { redirect: 'manual' });
    expect(signedOut.status).toBe(200);
    expect(await signedOut.text()).toContain(`/auth/login?next=${encodeURIComponent(path)}`);

    const addr = fresh();
    const cookie = await signUp(addr, path);
    const opened = await fetch(link, { headers: { cookie }, redirect: 'manual' });
    expect(await opened.text()).toContain('Accept and become a teacher');
    // Opening it changed nothing: the load only reads.
    expect(await asUser(sql, claimsOf(ADMIN), tx => inviteStatus(tx, secret))).toBe('open');

    const accepted = await fetch(`${link}?/accept`, ownForm({}, cookie));
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(await accepted.text()).toContain('You are a teacher now');
    expect(await asUser(sql, claimsOf(ADMIN), tx => inviteStatus(tx, secret))).toBe('unknown');

    const again = await fetch(`${link}?/accept`, ownForm({}, cookie));
    expect(again.status).toBe(403);
});

test('a link cut short is not an invite, and the page says so without asking anyone', async () => {
    const r = await fetch(`${app.origin}/invite/yk_invite_0123`, { redirect: 'manual' });
    expect(r.status).toBe(404);
});
