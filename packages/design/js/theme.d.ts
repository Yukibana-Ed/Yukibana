/** The person's colour theme, shared by the Yukibana sites: the system's scheme, or always light, or always dark.
 *
 *  The choice is kept twice, as `yk-theme`: in localStorage, and in a cookie on the site's registrable domain.
 *  localStorage belongs to one origin, so the cookie is what makes yukibana.dev and cloud.yukibana.dev (or a
 *  self-hoster's own pair) share it. Any value but `system`, `light` or `dark` counts as nothing. Nothing may read it
 *  for anything but the theme: any site under that domain can set it.
 *
 *  It is read in one place, the boot script (`themeBoot`), which shows it before the first paint. After that the page
 *  itself says what is chosen, so `readTheme` reads `data-theme` back instead of parsing the stores a second time.
 *
 *  This file is compiled to js/theme.js and js/theme.d.ts by `pnpm --filter @yukibana/design build`, and both are
 *  committed, like the generated CSS, so that an app installing the package from git builds nothing. */
export type Theme = 'system' | 'light' | 'dark';
/** The choices, in the order a switcher offers them. */
export declare const THEMES: readonly Theme[];
/** The inline script for the top of `<head>`: shows the stored choice before the first paint, so a page never flashes
 *  the other scheme. It takes the cookie's choice, else localStorage's; anything unreadable or garbled is the system's.
 *  Old JavaScript with no imports, and nothing that could close the script element it sits in. */
export declare function themeBoot(): string;
/** The choice the page shows. Requires: the page ran `themeBoot()`, and changes the theme only through `applyTheme`. */
export declare function readTheme(): Theme;
/** Keeps the choice in localStorage and in the cookie. The cookie goes on the broadest parent domain the browser
 *  accepts: browsers refuse public suffixes (`dev`, `github.io`, `co.uk`), so it lands on the site's registrable domain,
 *  whoever hosts it. Where none sticks (localhost, an IP address) it belongs to the host alone. */
export declare function writeTheme(theme: Theme): void;
/** Shows the theme: `data-theme` on <html>, which tokens.css follows, removed for "system". */
export declare function applyTheme(theme: Theme): void;
