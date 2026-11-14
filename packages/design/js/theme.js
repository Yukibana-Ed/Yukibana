/** The person's colour theme, shared by the Yukibana sites: the system's scheme, or always light, or always dark.
 *
 *  The choice is kept twice, as `yk-theme`: in localStorage, and in a cookie for Domain=yukibana.dev. localStorage
 *  belongs to one origin, so the cookie is what makes yukibana.dev and cloud.yukibana.dev share it; on any other host
 *  (localhost, a preview) the browser drops that cookie and localStorage alone keeps it. Any value but `system`,
 *  `light` or `dark` counts as nothing. Nothing may read it for anything but the theme: any site under yukibana.dev
 *  can set it.
 *
 *  This file is compiled to js/theme.js and js/theme.d.ts by `pnpm --filter @yukibana/design build`, and both are
 *  committed, like the generated CSS, so that an app installing the package from git builds nothing. */
/** The choices, in the order a switcher offers them. */
export const THEMES = ['system', 'light', 'dark'];
/** The cookie and the localStorage key that hold the choice. */
export const THEME_KEY = 'yk-theme';
const valid = (value) => (value === 'system' || value === 'light' || value === 'dark' ? value : undefined);
/** The choice: the cookie's, else localStorage's, else "system". Anything unreadable or garbled counts as nothing. */
export function readTheme() {
    try {
        const theme = valid(/(?:^|;\s*)yk-theme=([^;]*)/.exec(document.cookie)?.[1]);
        if (theme)
            return theme;
    }
    catch { }
    try {
        return valid(localStorage.getItem(THEME_KEY)) ?? 'system';
    }
    catch {
        return 'system';
    }
}
/** Keeps the choice in both places. A browser that refuses one still has the other, or the page until it closes. */
export function writeTheme(theme) {
    try {
        document.cookie = `${THEME_KEY}=${theme}; Domain=yukibana.dev; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    }
    catch { }
    try {
        localStorage.setItem(THEME_KEY, theme);
    }
    catch { }
}
/** Shows the theme: `data-theme` on <html>, which tokens.css follows, removed for "system". */
export function applyTheme(theme) {
    if (theme === 'system')
        document.documentElement.removeAttribute('data-theme');
    else
        document.documentElement.setAttribute('data-theme', theme);
}
/** Calls `listener` with the system's scheme whenever it changes, and returns the function that stops it. Where the
 *  browser cannot tell (no `matchMedia`, Safari before 14), it never calls it. */
export function onSystemChange(listener) {
    const changed = (event) => listener(event.matches ? 'dark' : 'light');
    try {
        const query = matchMedia('(prefers-color-scheme: dark)');
        query.addEventListener('change', changed);
        return () => query.removeEventListener('change', changed);
    }
    catch {
        return () => { };
    }
}
/** The inline script for the top of `<head>` that does `applyTheme(readTheme())` before the first paint, so a page
 *  never flashes the other scheme: the same logic in the oldest JavaScript, with no imports. */
export function themeBoot() {
    return `(function () {
    var t;
    try {
        t = (/(?:^|;\\s*)yk-theme=([^;]*)/.exec(document.cookie) || [])[1];
    } catch (e) {}
    if (t !== 'system' && t !== 'light' && t !== 'dark') {
        try {
            t = localStorage.getItem('yk-theme');
        } catch (e) {}
    }
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();`;
}
