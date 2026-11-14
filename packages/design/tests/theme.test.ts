import { describe, expect, expectTypeOf, test } from 'vitest';
import { runInNewContext } from 'node:vm';
import { THEME_COOKIE, applyTheme, parseTheme, readTheme, sharesTheme, themeBoot, themeCookie, themeCookieValue, writeTheme, type ThemeDocument } from '../src/theme.ts';

/** As much of a browser as the theme touches: a cookie jar behind `document.cookie` that keeps the last string
 *  assigned, a localStorage, the root's attributes and the two theme-color metas. `cookies: 'refuse'` drops every
 *  cookie assigned (blocked cookies); `storage: 'refuse'` throws on every storage call (a private window). */
function browser(options: { url?: string; cookies?: 'keep' | 'refuse' | 'throw'; storage?: 'keep' | 'refuse' | 'none'; cookie?: string; stored?: Record<string, string> } = {}) {
    const url = new URL(options.url ?? 'https://cloud.yukibana.dev/');
    const jar = new Map<string, string>();
    for (const part of (options.cookie ?? '').split(';')) {
        const eq = part.indexOf('=');
        if (eq !== -1) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
    const assigned: string[] = [];
    const items = new Map(Object.entries(options.stored ?? {}));
    const refuse = (): never => {
        throw new Error('SecurityError');
    };
    const localStorage =
        options.storage === 'refuse'
            ? { getItem: refuse, setItem: refuse, removeItem: refuse }
            : {
                  getItem: (k: string) => items.get(k) ?? null,
                  setItem: (k: string, v: string) => void items.set(k, v),
                  removeItem: (k: string) => void items.delete(k),
              };
    const metas = (['light', 'dark'] as const).map(scheme => ({
        getAttribute: (name: string) => (name === 'data-scheme' ? scheme : null),
        media: `(prefers-color-scheme: ${scheme})`,
    }));
    const attributes = new Map<string, string>();
    const root = {
        setAttribute: (k: string, v: string) => void attributes.set(k, v),
        removeAttribute: (k: string) => void attributes.delete(k),
    };
    const location = { hostname: url.hostname, protocol: url.protocol };
    const view = options.storage === 'none' ? null : { localStorage };
    const document = {
        get cookie(): string {
            if (options.cookies === 'throw') refuse();
            return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
        },
        set cookie(value: string) {
            if (options.cookies === 'throw') refuse();
            assigned.push(value);
            if (options.cookies === 'refuse') return;
            const [pair = ''] = value.split(';');
            const eq = pair.indexOf('=');
            jar.set(pair.slice(0, eq), pair.slice(eq + 1));
        },
        location,
        defaultView: view,
        documentElement: root,
        querySelectorAll: () => metas,
    };
    return {
        document,
        /** What a script running on the page sees as its globals. */
        globals: { document, location, localStorage: options.storage === 'none' ? undefined : localStorage },
        jar,
        items,
        assigned,
        theme: () => attributes.get('data-theme') ?? null,
        media: () => metas.map(m => m.media),
    };
}

test("the browser's own document is a ThemeDocument, so the functions default to it", () => {
    expectTypeOf<Document>().toExtend<ThemeDocument>();
});

describe('the stored value', () => {
    test('only "light" and "dark" are fixed themes; anything else is the system theme', () => {
        expect(parseTheme('light')).toBe('light');
        expect(parseTheme('dark')).toBe('dark');
        for (const other of [null, undefined, '', 'system', 'Dark', ' dark', 'blue', 1, {}]) expect(parseTheme(other)).toBe('system');
    });

    test('is the first yk-theme cookie, among any others', () => {
        expect(themeCookieValue('')).toBeUndefined();
        expect(themeCookieValue('a=1; b=2')).toBeUndefined();
        expect(themeCookieValue('yk-theme=dark')).toBe('dark');
        expect(themeCookieValue('a=1;yk-theme=light; b=2')).toBe('light');
        expect(themeCookieValue('yk-theme=dark; yk-theme=light')).toBe('dark');
        expect(themeCookieValue('xyk-theme=dark; yk-themes=dark')).toBeUndefined();
        expect(themeCookieValue('yk-theme=')).toBe('');
    });
});

describe('the cookie', () => {
    test('is shared across yukibana.dev, and Secure there', () => {
        for (const hostname of ['yukibana.dev', 'cloud.yukibana.dev', 'light.yukibana.dev']) {
            expect(sharesTheme(hostname), hostname).toBe(true);
            expect(themeCookie('dark', { hostname, protocol: 'https:' })).toBe('yk-theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Domain=yukibana.dev; Secure');
        }
    });

    test('belongs to the host alone anywhere else, and is Secure only over HTTPS', () => {
        for (const hostname of ['localhost', '127.0.0.1', 'notyukibana.dev', 'yukibana.dev.evil.example', 'preview.pages.dev']) {
            expect(sharesTheme(hostname), hostname).toBe(false);
        }
        expect(themeCookie('light', { hostname: 'localhost', protocol: 'http:' })).toBe('yk-theme=light; Path=/; Max-Age=31536000; SameSite=Lax');
        expect(themeCookie('system', { hostname: 'preview.pages.dev', protocol: 'https:' })).toBe('yk-theme=system; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
    });

    test('keeps every choice, System included, and reads it back', () => {
        const b = browser();
        expect(readTheme({ document: b.document })).toBe('system');
        for (const theme of ['dark', 'light', 'system'] as const) {
            writeTheme(theme, { document: b.document });
            expect(b.jar.get(THEME_COOKIE)).toBe(theme);
            expect(readTheme({ document: b.document })).toBe(theme);
        }
        expect(b.assigned.at(-1)).toBe('yk-theme=system; Path=/; Max-Age=31536000; SameSite=Lax; Domain=yukibana.dev; Secure');
    });

    test('a junk value, as a sibling page could set, is the system theme', () => {
        for (const junk of ['Dark', 'darker', '"dark"', '%64ark', '']) {
            expect(readTheme({ document: browser({ cookie: `yk-theme=${junk}` }).document }), junk).toBe('system');
        }
    });

    test('cookies that are refused or throw never break the page', () => {
        const refused = browser({ cookies: 'refuse' });
        expect(() => writeTheme('dark', { document: refused.document })).not.toThrow();
        expect(readTheme({ document: refused.document })).toBe('system');
        const throwing = browser({ cookies: 'throw' });
        expect(() => writeTheme('dark', { document: throwing.document })).not.toThrow();
        expect(readTheme({ document: throwing.document, legacyKey: 'old' })).toBe('system');
    });
});

describe('moving an app off its old localStorage key', () => {
    test('a light or dark kept there becomes the cookie, and the key goes', () => {
        const b = browser({ stored: { 'yukibana-theme': 'dark', other: 'x' } });
        expect(readTheme({ document: b.document, legacyKey: 'yukibana-theme' })).toBe('dark');
        expect(b.jar.get(THEME_COOKIE)).toBe('dark');
        expect([...b.items]).toEqual([['other', 'x']]);
        // Once: from now on it is the cookie that is read.
        writeTheme('light', { document: b.document });
        expect(readTheme({ document: b.document, legacyKey: 'yukibana-theme' })).toBe('light');
    });

    test('the cookie wins over the old key, which goes', () => {
        const b = browser({ cookie: 'yk-theme=system', stored: { theme: 'dark' } });
        expect(readTheme({ document: b.document, legacyKey: 'theme' })).toBe('system');
        expect(b.items.has('theme')).toBe(false);
        expect(b.assigned).toEqual([]);
    });

    test('nothing, "system" or junk under the old key writes nothing', () => {
        for (const stored of [{}, { theme: 'system' }, { theme: 'blue' }]) {
            const b = browser({ stored });
            expect(readTheme({ document: b.document, legacyKey: 'theme' })).toBe('system');
            expect(b.assigned).toEqual([]);
            expect(Object.fromEntries(b.items)).toEqual(stored);
        }
    });

    test('a browser that refuses the cookie keeps the old key, and the page still shows its choice', () => {
        const b = browser({ cookies: 'refuse', stored: { theme: 'light' } });
        expect(readTheme({ document: b.document, legacyKey: 'theme' })).toBe('light');
        expect(b.items.get('theme')).toBe('light');
    });

    test('a storage that throws, or none at all, is no old choice', () => {
        expect(readTheme({ document: browser({ storage: 'refuse' }).document, legacyKey: 'theme' })).toBe('system');
        expect(readTheme({ document: browser({ storage: 'none' }).document, legacyKey: 'theme' })).toBe('system');
        expect(readTheme({ document: browser({ storage: 'refuse', cookie: 'yk-theme=dark' }).document, legacyKey: 'theme' })).toBe('dark');
    });

    test('without a legacy key, localStorage is never touched', () => {
        const b = browser({ stored: { 'yukibana-theme': 'dark', theme: 'dark' } });
        expect(readTheme({ document: b.document })).toBe('system');
        expect(b.items.size).toBe(2);
    });
});

test('a fixed theme sets data-theme and turns on its own theme-color; System puts both back', () => {
    const b = browser();
    applyTheme('dark', { document: b.document });
    expect(b.theme()).toBe('dark');
    expect(b.media()).toEqual(['not all', 'all']);
    applyTheme('light', { document: b.document });
    expect(b.theme()).toBe('light');
    expect(b.media()).toEqual(['all', 'not all']);
    applyTheme('system', { document: b.document });
    expect(b.theme()).toBeNull();
    expect(b.media()).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']);
});

describe('the boot script', () => {
    /** Every situation a page can load in: where it is, which cookie it has, what its old key holds, what the browser
     *  refuses. */
    const situations = (() => {
        const all: Parameters<typeof browser>[0][] = [];
        for (const url of ['https://cloud.yukibana.dev/', 'https://yukibana.dev/docs', 'http://localhost:5173/', 'https://preview.pages.dev/'])
            for (const cookie of [undefined, 'yk-theme=dark', 'yk-theme=light', 'yk-theme=system', 'a=1; yk-theme=junk'])
                for (const old of [undefined, 'dark', 'light', 'system', 'junk'])
                    for (const cookies of ['keep', 'refuse', 'throw'] as const)
                        for (const storage of ['keep', 'refuse'] as const)
                            all.push({ url, cookies, storage, ...(cookie === undefined ? {} : { cookie }), ...(old === undefined ? {} : { stored: { old } }) });
        return all;
    })();

    for (const legacyKey of [undefined, 'old']) {
        test(`does exactly what readTheme and applyTheme do, ${legacyKey === undefined ? 'without' : 'with'} a legacy key`, () => {
            const boot = themeBoot(legacyKey);
            for (const situation of situations) {
                const inline = browser(situation);
                expect(() => {
                    runInNewContext(boot, inline.globals);
                }, JSON.stringify(situation)).not.toThrow();
                const expected = browser(situation);
                applyTheme(readTheme({ document: expected.document, ...(legacyKey === undefined ? {} : { legacyKey }) }), { document: expected.document });
                const state = (b: ReturnType<typeof browser>) => ({ theme: b.theme(), media: b.media(), jar: [...b.jar], items: [...b.items], assigned: b.assigned });
                expect(state(inline), JSON.stringify(situation)).toEqual(state(expected));
            }
        });
    }

    test('cannot close the script element it sits in', () => {
        expect(themeBoot('</script><script>alert(1)//')).not.toContain('</script>');
        // Any key arrives in the script as it is: quotes, backslashes and all.
        for (const key of ["it's", 'a"b', 'back\\slash', '</script>']) {
            const b = browser({ stored: { [key]: 'dark' } });
            runInNewContext(themeBoot(key), b.globals);
            expect(b.theme(), key).toBe('dark');
            expect(b.items.has(key), key).toBe(false);
        }
    });

    test('is plain old JavaScript: no arrow functions, let, const or template literals', () => {
        const boot = themeBoot('theme');
        expect(boot).not.toMatch(/=>|\blet\b|\bconst\b|`/);
    });
});
