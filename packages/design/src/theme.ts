/** The person's colour theme, shared by every Yukibana site under yukibana.dev: the system's scheme, or always light,
 *  or always dark.
 *
 *  The choice lives in one cookie, `yk-theme` (THEME_COOKIE), set for the whole of yukibana.dev, so that choosing Dark
 *  on yukibana.dev is also the choice on cloud.yukibana.dev. localStorage cannot do that: it belongs to one origin.
 *  Its value is `system`, `light` or `dark`, and anything else reads as `system`.
 *
 *  The cookie carries no authority. Any page under yukibana.dev can set it, Light's included, which runs programs
 *  people paste into it, so it is deliberately not a `__Host-` cookie, and nothing may read it for anything but the
 *  theme: the worst a sibling can do with it is change a visitor's colours. No server needs it either; only the
 *  page's own script reads it.
 *
 *  The page shows the theme by `data-theme` on <html>, which tokens.css follows ("system" removes the attribute), and by
 *  its `theme-color` metas. An inline script made by `themeBoot` applies it before the first paint, so a page never
 *  flashes the other scheme; this module's own tests run that script against the functions here.
 *
 *  This file is compiled to js/theme.js and js/theme.d.ts by `pnpm --filter @yukibana/design build`, and both are
 *  committed, like the generated CSS, so that an app installing the package from git builds nothing. */

export type Theme = 'system' | 'light' | 'dark';

/** The choices, in the order a switcher offers them. */
export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/** The cookie that holds the choice. */
export const THEME_COOKIE = 'yk-theme';

/** The domain the cookie is shared across: this host and every subdomain of it. */
export const THEME_DOMAIN = 'yukibana.dev';

/** How long the cookie lasts, in seconds: a year. */
export const THEME_MAX_AGE = 31_536_000;

/** What a stored value means: "light" and "dark" are themselves, and anything else ("system", nothing stored, junk,
 *  another case) is the system's. */
export function parseTheme(value: unknown): Theme {
    return value === 'light' || value === 'dark' ? value : 'system';
}

/** The value of the first `yk-theme` cookie in `cookies` (a Cookie header, or `document.cookie`), as it is, or
 *  undefined when there is none. */
export function themeCookieValue(cookies: string): string | undefined {
    for (const part of cookies.split(';')) {
        const eq = part.indexOf('=');
        if (eq !== -1 && part.slice(0, eq).trim() === THEME_COOKIE) return part.slice(eq + 1).trim();
    }
    return undefined;
}

/** Whether a page on `hostname` shares the cookie across yukibana.dev: yukibana.dev itself and its subdomains. */
export function sharesTheme(hostname: string): boolean {
    return hostname === THEME_DOMAIN || hostname.endsWith(`.${THEME_DOMAIN}`);
}

/** The string to assign to `document.cookie` to keep `theme`, on a page at `location`.
 *
 *  Under yukibana.dev it is `Domain=yukibana.dev` and `Secure`, so every site there reads it. Anywhere else (localhost,
 *  a preview host) it has no Domain, so it belongs to that host alone, all its ports included; it is Secure only over
 *  HTTPS, because a browser refuses a Secure cookie from a page served over plain HTTP. */
export function themeCookie(theme: Theme, location: Pick<Location, 'hostname' | 'protocol'>): string {
    const shared = sharesTheme(location.hostname);
    const attributes = [`${THEME_COOKIE}=${theme}`, 'Path=/', `Max-Age=${THEME_MAX_AGE}`, 'SameSite=Lax'];
    if (shared) attributes.push(`Domain=${THEME_DOMAIN}`);
    if (shared || location.protocol === 'https:') attributes.push('Secure');
    return attributes.join('; ');
}

/** As much of the page's `document` as the theme touches. The browser's own `document` is one. */
export interface ThemeDocument {
    cookie: string;
    readonly location: Pick<Location, 'hostname' | 'protocol'>;
    readonly defaultView: { readonly localStorage: Pick<Storage, 'getItem' | 'removeItem'> } | null;
    readonly documentElement: Pick<Element, 'setAttribute' | 'removeAttribute'>;
    querySelectorAll(selectors: string): ArrayLike<Pick<HTMLMetaElement, 'getAttribute' | 'media'>>;
}

/** Where the functions below find the page. Each defaults to the browser's own. */
export interface ThemeOptions {
    /** The page's document, for its cookie, its location, its root and its metas. */
    readonly document?: ThemeDocument;
    /** The localStorage key under which this app kept the choice before the cookie (the cloud's `yukibana-theme`,
     *  next-themes' `theme`). When it is given and there is no cookie yet, a "light" or "dark" found there becomes the
     *  cookie; once there is a cookie, the key is removed. */
    readonly legacyKey?: string;
}

const pageOf = (options: ThemeOptions): ThemeDocument => options.document ?? globalThis.document;

/** The page's localStorage, or undefined where it is missing or refused (a private window, blocked site data). */
function storageOf(doc: ThemeDocument): Pick<Storage, 'getItem' | 'removeItem'> | undefined {
    try {
        return doc.defaultView?.localStorage ?? undefined;
    } catch {
        return undefined;
    }
}

/** The choice: the cookie's, or, the first time an app that kept it in localStorage reads it, the one kept there, moved
 *  into the cookie. A cookie that cannot be read is "system". */
export function readTheme(options: ThemeOptions = {}): Theme {
    const doc = pageOf(options);
    let stored: string | undefined;
    try {
        stored = themeCookieValue(doc.cookie);
    } catch {
        return 'system';
    }
    if (options.legacyKey === undefined) return parseTheme(stored);
    const storage = storageOf(doc);
    try {
        if (stored === undefined) {
            const legacy = parseTheme(storage?.getItem(options.legacyKey));
            if (legacy === 'system') return 'system';
            writeTheme(legacy, { document: doc });
            stored = themeCookieValue(doc.cookie);
            // A browser that refused the cookie keeps the old key, so the choice is not lost; this page still shows it.
            if (stored === undefined) return legacy;
        }
        storage?.removeItem(options.legacyKey);
    } catch {
        // Storage that throws only means the old key stays.
    }
    return parseTheme(stored);
}

/** Keeps the choice, "system" included: a cookie that says "system" also stops an app's old localStorage choice from
 *  being moved in later. A browser that refuses the cookie only means the choice lasts until the page closes. */
export function writeTheme(theme: Theme, options: ThemeOptions = {}): void {
    const doc = pageOf(options);
    try {
        doc.cookie = themeCookie(theme, doc.location);
    } catch {
        // Nothing to do: the page still shows the choice.
    }
}

/** Shows the theme on the page: `data-theme` on the root ("system" removes it), and the browser's own colour to match.
 *
 *  The page has a `<meta name="theme-color">` for each scheme, marked `data-scheme="light"` or `"dark"` and chosen by
 *  a `prefers-color-scheme` media query; a fixed theme turns on its own one only. */
export function applyTheme(theme: Theme, options: ThemeOptions = {}): void {
    const doc = pageOf(options);
    const root = doc.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const metas = doc.querySelectorAll('meta[name="theme-color"][data-scheme]');
    for (let i = 0; i < metas.length; i++) {
        const meta = metas[i];
        if (meta === undefined) continue;
        const scheme = meta.getAttribute('data-scheme');
        meta.media = theme === 'system' ? `(prefers-color-scheme: ${scheme})` : theme === scheme ? 'all' : 'not all';
    }
}

/** Calls `listener` with the system's scheme whenever it changes (for a switcher that shows what "System" is now), and
 *  returns the function that stops it. */
export function onSystemChange(listener: (scheme: 'light' | 'dark') => void, view: Pick<Window, 'matchMedia'> = globalThis.window): () => void {
    const query = view.matchMedia('(prefers-color-scheme: dark)');
    const changed = (event: MediaQueryListEvent): void => listener(event.matches ? 'dark' : 'light');
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
}

/** The inline script that applies the choice before the first paint: readTheme, then applyTheme, written out by hand in
 *  the oldest JavaScript, with no imports, to put in a `<script>` at the top of `<head>`, after the theme-color metas.
 *  `legacyKey` is readTheme's. Everything it does is inside `try`, so a refused cookie or storage leaves the page on
 *  the system's scheme rather than breaking it. tests/theme.test.ts runs it against the functions above. */
export function themeBoot(legacyKey?: string): string {
    // A single-quoted JavaScript string, as the repository's formatter leaves one, with `<` escaped so that it can never
    // close the <script> it sits in.
    const literal = (value: string | null): string =>
        value === null ? 'null' : `'${JSON.stringify(value).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'").replace(/</g, '\\u003c')}'`;
    return `(function () {
    var name = ${literal(THEME_COOKIE)};
    var key = ${literal(legacyKey ?? null)};
    function cookie() {
        var parts = document.cookie.split(';');
        for (var i = 0; i < parts.length; i++) {
            var eq = parts[i].indexOf('=');
            if (eq !== -1 && parts[i].slice(0, eq).trim() === name) return parts[i].slice(eq + 1).trim();
        }
        return null;
    }
    try {
        var theme = cookie();
        if (key !== null) {
            try {
                if (theme === null) {
                    var old = localStorage.getItem(key);
                    if (old === 'light' || old === 'dark') {
                        var host = location.hostname;
                        var shared = host === ${literal(THEME_DOMAIN)} || host.slice(-${THEME_DOMAIN.length + 1}) === ${literal(`.${THEME_DOMAIN}`)};
                        var set = name + '=' + old + '; Path=/; Max-Age=${THEME_MAX_AGE}; SameSite=Lax';
                        if (shared) set += '; Domain=${THEME_DOMAIN}';
                        if (shared || location.protocol === 'https:') set += '; Secure';
                        document.cookie = set;
                        theme = cookie();
                        if (theme === null) theme = old;
                        else localStorage.removeItem(key);
                    }
                } else localStorage.removeItem(key);
            } catch (e) {}
        }
        if (theme === 'light' || theme === 'dark') {
            document.documentElement.setAttribute('data-theme', theme);
            var metas = document.querySelectorAll('meta[name="theme-color"][data-scheme]');
            for (var j = 0; j < metas.length; j++) metas[j].media = metas[j].getAttribute('data-scheme') === theme ? 'all' : 'not all';
        }
    } catch (e) {}
})();`;
}
