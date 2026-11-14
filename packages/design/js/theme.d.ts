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
export declare const THEMES: readonly Theme[];
/** The cookie that holds the choice. */
export declare const THEME_COOKIE = "yk-theme";
/** The domain the cookie is shared across: this host and every subdomain of it. */
export declare const THEME_DOMAIN = "yukibana.dev";
/** How long the cookie lasts, in seconds: a year. */
export declare const THEME_MAX_AGE = 31536000;
/** What a stored value means: "light" and "dark" are themselves, and anything else ("system", nothing stored, junk,
 *  another case) is the system's. */
export declare function parseTheme(value: unknown): Theme;
/** The value of the first `yk-theme` cookie in `cookies` (a Cookie header, or `document.cookie`), as it is, or
 *  undefined when there is none. */
export declare function themeCookieValue(cookies: string): string | undefined;
/** Whether a page on `hostname` shares the cookie across yukibana.dev: yukibana.dev itself and its subdomains. */
export declare function sharesTheme(hostname: string): boolean;
/** The string to assign to `document.cookie` to keep `theme`, on a page at `location`.
 *
 *  Under yukibana.dev it is `Domain=yukibana.dev` and `Secure`, so every site there reads it. Anywhere else (localhost,
 *  a preview host) it has no Domain, so it belongs to that host alone, all its ports included; it is Secure only over
 *  HTTPS, because a browser refuses a Secure cookie from a page served over plain HTTP. */
export declare function themeCookie(theme: Theme, location: Pick<Location, 'hostname' | 'protocol'>): string;
/** As much of the page's `document` as the theme touches. The browser's own `document` is one. */
export interface ThemeDocument {
    cookie: string;
    readonly location: Pick<Location, 'hostname' | 'protocol'>;
    readonly defaultView: {
        readonly localStorage: Pick<Storage, 'getItem' | 'removeItem'>;
    } | null;
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
/** The choice: the cookie's, or, the first time an app that kept it in localStorage reads it, the one kept there, moved
 *  into the cookie. A cookie that cannot be read is "system". */
export declare function readTheme(options?: ThemeOptions): Theme;
/** Keeps the choice, "system" included: a cookie that says "system" also stops an app's old localStorage choice from
 *  being moved in later. A browser that refuses the cookie only means the choice lasts until the page closes. */
export declare function writeTheme(theme: Theme, options?: ThemeOptions): void;
/** Shows the theme on the page: `data-theme` on the root ("system" removes it), and the browser's own colour to match.
 *
 *  The page has a `<meta name="theme-color">` for each scheme, marked `data-scheme="light"` or `"dark"` and chosen by
 *  a `prefers-color-scheme` media query; a fixed theme turns on its own one only. */
export declare function applyTheme(theme: Theme, options?: ThemeOptions): void;
/** Calls `listener` with the system's scheme whenever it changes (for a switcher that shows what "System" is now), and
 *  returns the function that stops it. */
export declare function onSystemChange(listener: (scheme: 'light' | 'dark') => void, view?: Pick<Window, 'matchMedia'>): () => void;
/** The inline script that applies the choice before the first paint: readTheme, then applyTheme, written out by hand in
 *  the oldest JavaScript, with no imports, to put in a `<script>` at the top of `<head>`, after the theme-color metas.
 *  `legacyKey` is readTheme's. Everything it does is inside `try`, so a refused cookie or storage leaves the page on
 *  the system's scheme rather than breaking it. tests/theme.test.ts runs it against the functions above. */
export declare function themeBoot(legacyKey?: string): string;
