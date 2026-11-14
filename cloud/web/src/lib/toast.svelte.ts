/** One-off notices: a pill at the bottom centre of the window (yk-toast).
 *
 *  Two kinds, one family. A failure the person should hear about goes through `toast`, whether a form action refused
 *  (the layout passes those on) or a page's own request did, so none of them needs a place on the page of its own: it
 *  is the red pill, offers Retry when there is something to retry, and stays until it is retried or dismissed, since
 *  a failure read too late is a failure missed. Something that worked where no button could say so itself goes
 *  through `notify`: the dark pill, which fades after three seconds. Where a button can say it is done ("✓ Saved"),
 *  it does, and there is no notice at all.
 */

import { untrack } from 'svelte';

/** One notice on screen. */
export interface Toast {
    /** Its number, unique for the life of the page: what `dismiss` takes. */
    readonly id: number;
    /** `error` for a failure (red, stays), `done` for something that worked (dark, fades). */
    readonly kind: 'error' | 'done';
    /** The line shown, for the person. Two notices on screen never have the
     *  same message. */
    readonly message: string;
    /** Text to offer under "Copy details" (an incident's report), or null. */
    readonly details: string | null;
    /** What Retry does, for a failure that can be tried again; null shows no Retry. */
    readonly retry: (() => void) | null;
}

/** The notices on screen now, oldest first. Read by Toasts.svelte only. */
export const toasts: Toast[] = $state([]);

/** How long a notice that something worked stays, in milliseconds: the design system's `--yk-motion-toast`. */
const DONE_MS = 3000;

let next = 0;

/** Shows the failure `message` once, until it is dismissed or retried. Repeating the message already on screen adds
 *  nothing: two refusals for the same reason are one.
 *
 *  With `details`, the notice offers them under "Copy details". With `retry`, it offers Retry, which takes the notice
 *  away and calls `retry`.
 *
 *  Safe to call from an `$effect`: looking for the repeat is untracked, so
 *  the caller does not come to depend on `toasts`. It once did, and the
 *  layout's effect re-raised a refusal the moment it was dismissed, so the
 *  notice could not be closed. */
export function toast(message: string, details: string | null = null, retry: (() => void) | null = null): void {
    if (untrack(() => toasts.some(t => t.message === message))) return;
    toasts.push({ id: next++, kind: 'error', message, details, retry });
}

/** Shows `message`, that something worked, for three seconds. A repeat of the message on screen adds nothing. */
export function notify(message: string): void {
    if (untrack(() => toasts.some(t => t.message === message))) return;
    const id = next++;
    toasts.push({ id, kind: 'done', message, details: null, retry: null });
    setTimeout(() => dismiss(id), DONE_MS);
}

/** Takes notice `id` away now, before its time; one already gone is
 *  nothing to do. */
export function dismiss(id: number): void {
    const i = toasts.findIndex(t => t.id === id);
    if (i !== -1) toasts.splice(i, 1);
}
