/** Posting to a SvelteKit form action from script, for the controls that
 *  save as they are used and have no form to submit (a drag, a key press).
 *  The action is the same one a form would post to, so the server has one
 *  path for both.
 */

import { deserialize } from '$app/forms';

/** Posts `fields` to `action` (a URL such as `?tab=projects&/move`) and
 *  resolves when the action succeeded. Rejects with the action's own
 *  `error` sentence when it refused, so a caller can show it as it is.
 *  A `Blob` field is sent as a file named after the field, which makes the
 *  body multipart, as a form with a file input would. */
export async function postAction(action: string, fields: Record<string, string | Blob>): Promise<void> {
    const body = new FormData();
    for (const [name, value] of Object.entries(fields)) {
        if (typeof value === 'string') body.set(name, value);
        else body.set(name, value, name);
    }
    const res = await fetch(action, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
    let result: ReturnType<typeof deserialize>;
    try {
        result = deserialize(await res.text());
    } catch {
        throw new Error(`the server answered ${res.status}`);
    }
    if (result.type === 'success') return;
    // An action that saves redirects only when it did not get as far as
    // saving: requireClaims sends a lapsed session to the login page. Counting
    // that as success once left a reorder on screen that was never stored.
    if (result.type === 'redirect') throw new Error('you are no longer signed in; log in again and redo it');
    const said: unknown = result.type === 'failure' ? result.data?.['error'] : (result.error as { message?: unknown } | null)?.message;
    throw new Error(typeof said === 'string' ? said : `the server answered ${res.status}`);
}
