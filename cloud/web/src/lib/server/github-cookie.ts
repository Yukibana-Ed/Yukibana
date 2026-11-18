/** The two cookies of linking a repository: the GitHub token, for fifteen
 *  minutes, and the state of a connection in flight, for ten.
 *
 *  Both are sealed with AES-GCM under a key derived from the App's client
 *  secret, so a cookie is unreadable and unforgeable without it, and both
 *  are bound to the person who was signed in when they were set: the
 *  sealed `sub` must be the current session's, or the cookie is not used.
 *  Without that binding, on a shared machine, a second teacher signing in
 *  after the first could link the first teacher's private repository to a
 *  project of their own with the first teacher's proof of control, and the
 *  first teacher's next tag would send the hidden tests there.
 *
 *  Each cookie's name is sealed into it too (as AES-GCM's additional data),
 *  so a state cookie's value is never read as a token cookie's or the other
 *  way round. Both names are `__Host-`: only this host can set them, never a
 *  page on a sibling subdomain. Nothing about them is stored server-side.
 */

import { uuidOf, type EditionId, type ProjectId } from '#lib/ids.ts';

/** The GitHub token cookie's name. */
export const GITHUB_COOKIE = '__Host-yukibana-github';
/** The connection-in-flight cookie's name. */
export const GITHUB_STATE_COOKIE = '__Host-yukibana-github-state';

/** How long the token is held, in seconds: long enough to pick a
 *  repository, short enough that a forgotten one is soon worth nothing. */
export const GITHUB_TOKEN_SECONDS = 15 * 60;
/** How long a connection may take on GitHub's side, in seconds. */
export const GITHUB_STATE_SECONDS = 10 * 60;

/** The token cookie's attributes: what `__Host-` demands (Secure, path `/`,
 *  no Domain), HttpOnly, Lax, and fifteen minutes (`maxAge`, in seconds,
 *  matching the expiry sealed inside, which is what is checked). Lax, so it
 *  rides along on the redirect from `/auth/github/return` to the project
 *  page, which follows a navigation GitHub started. */
export const GITHUB_COOKIE_OPTIONS = { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: GITHUB_TOKEN_SECONDS } as const;
/** The state cookie's attributes: the same, for ten minutes. Lax because
 *  the return from GitHub is a cross-site top-level navigation, which is
 *  exactly what Lax lets a cookie ride along on. */
export const GITHUB_STATE_COOKIE_OPTIONS = { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: GITHUB_STATE_SECONDS } as const;

/** The key both cookies are sealed with, derived from the App's client
 *  secret by HKDF-SHA-256 (info `yukibana-github-cookie`, empty salt), so
 *  there is no secret of its own to provision. Rotating the client secret
 *  invalidates every cookie sealed under the old one, which costs at most
 *  fifteen minutes of connections. */
export async function cookieKey(clientSecret: string): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(clientSecret), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('yukibana-github-cookie') },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

const base64url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

function unbase64url(text: string): Uint8Array | null {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
    try {
        const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from(raw, c => c.charCodeAt(0));
    } catch {
        return null;
    }
}

/** `payload` sealed for the cookie `name`: a fresh 12-byte IV, then the
 *  AES-GCM ciphertext of its JSON, as base64url. */
async function seal(name: string, payload: object, key: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(name) }, key, new TextEncoder().encode(JSON.stringify(payload))),
    );
    const out = new Uint8Array(iv.length + sealed.length);
    out.set(iv);
    out.set(sealed, iv.length);
    return base64url(out);
}

/** What `seal` sealed for the cookie `name`, as an object, or null for
 *  anything that does not open: tampered, sealed under another key or for
 *  another cookie, or not a sealed value at all. */
async function open(name: string, value: string, key: CryptoKey): Promise<Record<string, unknown> | null> {
    const bytes = unbase64url(value);
    if (bytes === null || bytes.length <= 12 + 16) return null;
    try {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(name) }, key, bytes.slice(12));
        const v: unknown = JSON.parse(new TextDecoder().decode(plain));
        return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/** Seals `token`, the GitHub user-to-server token of the person whose
 *  Supabase id is `sub`, for the token cookie, valid for
 *  `GITHUB_TOKEN_SECONDS` from `now`. */
export const sealToken = (token: string, sub: string, key: CryptoKey, now: Date): Promise<string> =>
    seal(GITHUB_COOKIE, { token, sub, expires: now.getTime() + GITHUB_TOKEN_SECONDS * 1000 }, key);

/** The GitHub token in the token cookie `value`, or null when it is absent,
 *  does not open (tampered, another client secret), has expired by `now`,
 *  or was sealed for anybody but `sub`, the person signed in now. A caller
 *  given null for a cookie that was present deletes it, in a request that
 *  may write: the cookie is worth nothing. */
export async function openToken(value: string | undefined, sub: string, key: CryptoKey, now: Date): Promise<string | null> {
    if (value === undefined || value === '') return null;
    const v = await open(GITHUB_COOKIE, value, key);
    if (v === null || typeof v['token'] !== 'string' || v['sub'] !== sub || typeof v['expires'] !== 'number' || v['expires'] <= now.getTime()) return null;
    return v['token'];
}

/** A connection in flight: what `?/connectGithub` started, and what
 *  `/auth/github/return` must find before it asks GitHub anything. */
export interface GitHubState {
    /** The random value sent to GitHub as `state`, which GitHub sends back:
     *  a return whose `state` is not this one is not this browser's. */
    readonly state: string;
    /** The Supabase id of the person who pressed Connect: a return to
     *  anybody else's session is refused. */
    readonly sub: string;
    /** The edition and project whose page Connect was pressed on, to go back to. */
    readonly edition: EditionId;
    readonly project: ProjectId;
    /** True iff Connect was pressed while changing an existing link
     *  (`?relink`), so that the return shows the picker again rather than
     *  the link being changed. */
    readonly relink: boolean;
}

/** Seals `s` for the state cookie, valid for `GITHUB_STATE_SECONDS` from `now`. */
export const sealState = (s: GitHubState, key: CryptoKey, now: Date): Promise<string> =>
    seal(GITHUB_STATE_COOKIE, { ...s, expires: now.getTime() + GITHUB_STATE_SECONDS * 1000 }, key);

/** The connection in the state cookie `value`, or null when it is absent,
 *  does not open, or has expired by `now`. Whose it is, is the caller's
 *  check (`sub`), so it can tell "not yours" from "none". */
export async function openState(value: string | undefined, key: CryptoKey, now: Date): Promise<GitHubState | null> {
    if (value === undefined || value === '') return null;
    const v = await open(GITHUB_STATE_COOKIE, value, key);
    if (v === null || typeof v['expires'] !== 'number' || v['expires'] <= now.getTime()) return null;
    const { state, sub } = v;
    const edition = uuidOf<EditionId>(typeof v['edition'] === 'string' ? v['edition'] : null);
    const project = uuidOf<ProjectId>(typeof v['project'] === 'string' ? v['project'] : null);
    if (typeof state !== 'string' || typeof sub !== 'string' || edition === null || project === null) return null;
    return { state, sub, edition, project, relink: v['relink'] === true };
}
