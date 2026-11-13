/** The person's colour theme: the system's scheme, or always light, or always dark.
 *
 *  The choice lives in this browser's localStorage under THEME_KEY and nowhere else: not in a cookie (a sibling
 *  subdomain could read one, and the server has no use for it), not in the database. It is shown by `data-theme` on
 *  <html>, which the design system's tokens follow (@yukibana/design, tokens.css); "system" removes the attribute.
 *
 *  A small copy of `applyTheme` runs inline in app.html before the first paint, so a page never flashes the other
 *  scheme. tests/theme.test.ts runs that copy, so the two cannot drift apart. */

export type Theme = 'system' | 'light' | 'dark';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export const THEME_KEY = 'yukibana-theme';

/** What a stored value means: anything but "light" or "dark" (nothing stored, an old value, junk) is the system's. */
export function parseTheme(value: unknown): Theme {
    return value === 'light' || value === 'dark' ? value : 'system';
}

/** The stored choice. Storage can be missing or throw (a private window, blocked site data): that is "system". */
export function readTheme(storage: Pick<Storage, 'getItem'> | undefined): Theme {
    try {
        return parseTheme(storage?.getItem(THEME_KEY));
    } catch {
        return 'system';
    }
}

/** Keeps the choice; "system" forgets it. A storage that refuses only means the choice lasts until the page closes. */
export function writeTheme(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, theme: Theme): void {
    try {
        if (theme === 'system') storage?.removeItem(THEME_KEY);
        else storage?.setItem(THEME_KEY, theme);
    } catch {
        // Nothing to do: the page still shows the choice.
    }
}

/** Shows the theme on the page: `data-theme` on the root, and the browser's own colour (theme-color) to match. */
export function applyTheme(root: HTMLElement, theme: Theme): void {
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    // app.html has a theme-color for each scheme, chosen by a media query; a fixed theme turns on its own one only.
    for (const meta of root.ownerDocument.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][data-scheme]')) {
        const scheme = meta.dataset['scheme'];
        meta.media = theme === 'system' ? `(prefers-color-scheme: ${scheme})` : theme === scheme ? 'all' : 'not all';
    }
}
