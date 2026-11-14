import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { THEME_COOKIE, applyTheme, readTheme, themeBoot } from '@yukibana/design/theme';
import { LEGACY_THEME_KEY } from '../src/lib/theme';

// The theme itself, its cookie and its boot script are the design system's, and tested there
// (packages/design/tests/theme.test.ts). What is the cloud's: that app.html carries that boot script, with the cloud's
// old localStorage key, and that it shows on this page what the account menu's switcher reads back.

/** A page: its cookie jar, its localStorage, its root and its two theme-color metas, as much as the theme touches. */
function page(url: string, cookie: string, stored: Record<string, string>) {
    const jar = new Map<string, string>();
    for (const part of cookie.split(';')) {
        const eq = part.indexOf('=');
        if (eq !== -1) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
    const items = new Map(Object.entries(stored));
    const localStorage = {
        getItem: (k: string) => items.get(k) ?? null,
        setItem: (k: string, v: string) => void items.set(k, v),
        removeItem: (k: string) => void items.delete(k),
    };
    const metas = (['light', 'dark'] as const).map(scheme => ({
        getAttribute: (name: string) => (name === 'data-scheme' ? scheme : null),
        media: `(prefers-color-scheme: ${scheme})`,
    }));
    const attributes = new Map<string, string>();
    const { hostname, protocol } = new URL(url);
    const location = { hostname, protocol };
    const document = {
        get cookie(): string {
            return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
        },
        set cookie(value: string) {
            const [pair = ''] = value.split(';');
            const eq = pair.indexOf('=');
            jar.set(pair.slice(0, eq), pair.slice(eq + 1));
        },
        location,
        defaultView: { localStorage },
        documentElement: {
            setAttribute: (k: string, v: string) => void attributes.set(k, v),
            removeAttribute: (k: string) => void attributes.delete(k),
        },
        querySelectorAll: () => metas,
    };
    return {
        document,
        globals: { document, location, localStorage },
        state: () => ({ theme: attributes.get('data-theme') ?? null, media: metas.map(m => m.media), cookie: jar.get(THEME_COOKIE) ?? null, items: [...items] }),
    };
}

const html = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');
const boot = /<script id="theme-boot">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
const words = (js: string): string => js.replace(/\s+/g, '');

test("app.html's boot script is the design system's, for the cloud's old key", () => {
    expect(words(boot), 'paste themeBoot(LEGACY_THEME_KEY) from @yukibana/design/theme into app.html\'s <script id="theme-boot">').toBe(words(themeBoot(LEGACY_THEME_KEY)));
});

test('app.html applies the choice before the first paint, exactly as the switcher reads it back', () => {
    for (const url of ['https://cloud.yukibana.dev/', 'http://localhost:5173/'])
        for (const cookie of ['', 'yk-theme=dark', 'yk-theme=light', 'yk-theme=system', 'yk-theme=junk'])
            for (const old of [undefined, 'dark', 'light', 'junk']) {
                const stored: Record<string, string> = old === undefined ? {} : { [LEGACY_THEME_KEY]: old };
                const inline = page(url, cookie, stored);
                runInNewContext(boot, inline.globals);
                const expected = page(url, cookie, stored);
                applyTheme(readTheme({ document: expected.document, legacyKey: LEGACY_THEME_KEY }), { document: expected.document });
                expect(inline.state(), `${url} ${cookie} ${old}`).toEqual(expected.state());
            }
});

test("the cloud's old choice moves into the shared cookie, once", () => {
    const p = page('https://cloud.yukibana.dev/', '', { [LEGACY_THEME_KEY]: 'dark' });
    runInNewContext(boot, p.globals);
    expect(p.state()).toEqual({ theme: 'dark', media: ['not all', 'all'], cookie: 'dark', items: [] });
});
