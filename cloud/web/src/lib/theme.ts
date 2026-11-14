/** The person's colour theme is the design system's (@yukibana/design/theme): one `yk-theme` cookie for every site under
 *  yukibana.dev, so a choice made on the docs site holds here too, and the other way round. Only the page's own script
 *  reads it, for the theme alone: any page under yukibana.dev can set it, so the server never reads it at all.
 *
 *  Before that cookie the cloud kept the choice in this browser's localStorage, under this key. The first page that
 *  finds a choice there moves it into the cookie (app.html's boot script, and readTheme given this key). */
export const LEGACY_THEME_KEY = 'yukibana-theme';
