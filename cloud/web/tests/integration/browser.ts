/** A browser's session with the app, for the suites that drive it over HTTP
 *  (see app.ts): logging in by the code mailed to an address, through the
 *  app's own login page, as a person would. */
import { codeMailedTo } from './mail.js';

/** A form this site's own page submits, as a browser does without
 *  JavaScript (it accepts HTML, so an action's redirect is a 303). */
export const ownForm = (origin: string, fields: Record<string, string>): RequestInit => ({
    method: 'POST',
    redirect: 'manual',
    headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
    body: new URLSearchParams(fields),
});

/** Logs `addr` in at the app at `origin` and returns the session as the
 *  browser would send it back: a Cookie header. Throws, with the app's
 *  answer, when a step does not do what a login does. */
export async function signIn(origin: string, addr: string): Promise<string> {
    const since = Date.now();
    const sent = await fetch(`${origin}/auth/login?/send`, ownForm(origin, { email: addr, next: '/' }));
    if (sent.status !== 200) throw new Error(`asking for a code answered ${sent.status}: ${await sent.text()}`);
    const verified = await fetch(`${origin}/auth/login?/verify`, ownForm(origin, { email: addr, code: await codeMailedTo(addr, since), next: '/' }));
    if (verified.status !== 303) throw new Error(`the code answered ${verified.status}: ${await verified.text()}`);
    const cookies = verified.headers
        .getSetCookie()
        .map(line => line.split(';')[0] ?? '')
        .filter(pair => !pair.endsWith('='));
    if (cookies.length === 0) throw new Error('logging in set no cookie');
    return cookies.join('; ');
}
