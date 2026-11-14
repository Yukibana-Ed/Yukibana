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
export type Theme = 'system' | 'light' | 'dark';
/** The choices, in the order a switcher offers them. */
export declare const THEMES: readonly Theme[];
/** The cookie and the localStorage key that hold the choice. */
export declare const THEME_KEY = "yk-theme";
/** The choice: the cookie's, else localStorage's, else "system". Anything unreadable or garbled counts as nothing. */
export declare function readTheme(): Theme;
/** Keeps the choice in both places. A browser that refuses one still has the other, or the page until it closes. */
export declare function writeTheme(theme: Theme): void;
/** Shows the theme: `data-theme` on <html>, which tokens.css follows, removed for "system". */
export declare function applyTheme(theme: Theme): void;
/** Calls `listener` with the system's scheme whenever it changes, and returns the function that stops it. Where the
 *  browser cannot tell (no `matchMedia`, Safari before 14), it never calls it. */
export declare function onSystemChange(listener: (scheme: 'light' | 'dark') => void): () => void;
/** The inline script for the top of `<head>` that does `applyTheme(readTheme())` before the first paint, so a page
 *  never flashes the other scheme: the same logic in the oldest JavaScript, with no imports. */
export declare function themeBoot(): string;
