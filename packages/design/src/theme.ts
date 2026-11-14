/** The person's colour theme, shared by the Yukibana sites: the system's scheme, or always light, or always dark.
 *
 *  The choice is kept twice, as `yk-theme`: in localStorage, and in a cookie on the site's registrable domain.
 *  localStorage belongs to one origin, so the cookie is what makes two sites of one domain (yukibana.dev and
 *  cloud.yukibana.dev, or a self-hoster's own pair) share it. Any value but `system`, `light` or `dark` counts as
 *  nothing. Nothing may read it for anything but the theme: any site under that domain can set it.
 *
 *  It is read in one place, `THEME_BOOT`, which shows it before the first paint. After that the page itself says what
 *  is chosen, so `readTheme` reads `data-theme` back instead of parsing the stores a second time.
 *
 *  The package exports this file as it is: an app's bundler compiles it (Vite does; a Vite app that renders on the
 *  server and gets the package from node_modules lists it in `ssr.noExternal`, because Node will not strip types there). */

/** The choices, in the order a switcher offers them. */
export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

const KEY = 'yk-theme';

/** The inline script for the top of `<head>`: shows the stored choice before the first paint, so a page never flashes
 *  the other scheme. It takes the cookie's choice, else localStorage's (which throws where site data is blocked);
 *  anything else is the system's. Old JavaScript with no imports, and nothing that could close its script element. */
export const THEME_BOOT = `(function () {
    var t = (/(?:^|;\\s*)${KEY}=([^;]*)/.exec(document.cookie) || [])[1];
    if (t !== 'system' && t !== 'light' && t !== 'dark') {
        try {
            t = localStorage.getItem('${KEY}');
        } catch (e) {}
    }
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();`;

/** The choice the page shows. Requires: the page ran `THEME_BOOT`, and changes the theme only through `chooseTheme`. */
export function readTheme(): Theme {
    const shown = document.documentElement.getAttribute('data-theme');
    return shown === 'light' || shown === 'dark' ? shown : 'system';
}

/** Shows `theme` (`data-theme` on <html>, which tokens.css follows, removed for "system") and keeps it in localStorage
 *  and in the cookie. The cookie goes on the broadest parent domain the browser accepts: browsers refuse public suffixes
 *  (`dev`, `github.io`, `co.uk`), so it lands on the site's registrable domain, whoever hosts it, and where none sticks
 *  (localhost, an IP address) it belongs to the host alone. It is not `Secure`, so a site served over plain http keeps
 *  it too: it carries no authority. Requires: a page of its own origin, not a sandboxed frame. */
export function chooseTheme(theme: Theme): void {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try {
        localStorage.setItem(KEY, theme);
    } catch {}
    const cookie = `${KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    const labels = location.hostname.split('.');
    for (let n = 2; n <= labels.length; n++) {
        document.cookie = `${cookie}; Domain=${labels.slice(-n).join('.')}`;
        if (document.cookie.split('; ').includes(`${KEY}=${theme}`)) return;
    }
    document.cookie = cookie;
}
