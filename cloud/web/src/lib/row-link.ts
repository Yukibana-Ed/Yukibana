/** Rows that are links.
 *
 *  In a table every row is a link to what it lists: a click anywhere on it opens that page. The row's title stays a
 *  real link, which is what a keyboard, a screen reader and a middle click use; the row only adds the larger target
 *  for a pointer. A click on a control inside the row (a link, a button, a field) is that control's, and a click that
 *  ends a text selection selects. */

import { goto } from '$app/navigation';

/** For a row's `onclick`: opens the row's `data-href`, in a new tab with Ctrl or ⌘ held. */
export function followRow(e: MouseEvent & { currentTarget: HTMLElement }): void {
    const href = e.currentTarget.dataset['href'];
    if (href === undefined) return;
    if (e.target instanceof Element && e.target.closest('a, button, input, select, textarea, label, summary') !== null) return;
    if ((window.getSelection()?.toString() ?? '') !== '') return;
    if (e.ctrlKey || e.metaKey) window.open(href, '_blank', 'noopener');
    else void goto(href);
}
