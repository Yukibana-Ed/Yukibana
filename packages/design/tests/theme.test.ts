import { afterEach, describe, expect, test, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { applyTheme, readTheme, themeBoot, writeTheme } from '../src/theme.ts';

/** The public suffixes the fake browser refuses a cookie for, as a real one does from the Public Suffix List. */
const PUBLIC_SUFFIXES = new Set(['dev', 'io', 'github.io', 'uk', 'co.uk', 'example']);

/** As much of a browser as the theme touches: a page on `host`, a cookie jar behind `document.cookie` that refuses a
 *  Domain the host cannot set, a localStorage and the root's attributes. Either store can drop everything ('refuse')
 *  or throw ('throw', blocked site data). */
function browser(options: { host?: string; cookie?: string; stored?: string; cookies?: 'keep' | 'refuse' | 'throw'; storage?: 'keep' | 'refuse' | 'throw' } = {}) {
    const hostname = options.host ?? 'cloud.yukibana.dev';
    const ip = /^[\d.]+$/.test(hostname);
    let jar = options.cookie ?? '';
    /** The Domain of the cookie the jar last kept, or null for a host-only one. */
    let domain: string | null = null;
    const items = new Map<string, string>(options.stored === undefined ? [] : [['yk-theme', options.stored]]);
    const attributes = new Map<string, string>();
    const blocked = (): never => {
        throw new Error('SecurityError');
    };
    const document = {
        get cookie(): string {
            return options.cookies === 'throw' ? blocked() : jar;
        },
        set cookie(value: string) {
            if (options.cookies === 'throw') blocked();
            if (options.cookies === 'refuse') return;
            const wanted = /; Domain=([^;]*)/.exec(value)?.[1] ?? null;
            const allowed = wanted === null || wanted === hostname || (!ip && !PUBLIC_SUFFIXES.has(wanted) && hostname.endsWith(`.${wanted}`));
            if (!allowed) return;
            jar = value.split(';')[0] ?? '';
            domain = wanted;
        },
        documentElement: {
            getAttribute: (k: string) => attributes.get(k) ?? null,
            setAttribute: (k: string, v: string) => void attributes.set(k, v),
            removeAttribute: (k: string) => void attributes.delete(k),
        },
    };
    const localStorage = {
        getItem: (k: string) => (options.storage === 'throw' ? blocked() : (items.get(k) ?? null)),
        setItem: (k: string, v: string) => (options.storage === 'throw' ? blocked() : options.storage === 'refuse' ? undefined : void items.set(k, v)),
    };
    return {
        globals: { document, localStorage, location: { hostname } },
        /** Makes this the page the module's functions see. */
        install() {
            vi.stubGlobal('document', document);
            vi.stubGlobal('localStorage', localStorage);
            vi.stubGlobal('location', { hostname });
        },
        cookie: () => jar,
        domain: () => domain,
        stored: () => items.get('yk-theme'),
        theme: () => attributes.get('data-theme') ?? null,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

/** What a page on `b` shows once its boot script ran: the switcher's reading of it. */
function booted(b: ReturnType<typeof browser>): string {
    runInNewContext(themeBoot(), b.globals);
    b.install();
    return readTheme();
}

describe('the choice', () => {
    test('is written to the shared cookie and to localStorage, and the next page shows it', () => {
        const b = browser();
        expect(booted(b)).toBe('system');
        for (const theme of ['dark', 'light', 'system'] as const) {
            b.install();
            writeTheme(theme);
            expect(b.stored()).toBe(theme);
            expect(booted(browser({ cookie: b.cookie() }))).toBe(theme);
        }
        expect(b.cookie()).toBe('yk-theme=system');
    });

    test('the cookie wins over localStorage, which is used without one', () => {
        expect(booted(browser({ cookie: 'a=1; yk-theme=dark; b=2', stored: 'light' }))).toBe('dark');
        expect(booted(browser({ cookie: 'yk-theme=system', stored: 'light' }))).toBe('system');
        expect(booted(browser({ cookie: 'a=1', stored: 'light' }))).toBe('light');
    });

    test('a garbled value counts as nothing', () => {
        for (const junk of ['Dark', 'darker', '"dark"', '', '=;;']) {
            expect(booted(browser({ cookie: `yk-theme=${junk}`, stored: junk })), junk).toBe('system');
            expect(booted(browser({ cookie: `yk-theme=${junk}`, stored: 'dark' })), junk).toBe('dark');
        }
        expect(booted(browser({ cookie: 'xyk-theme=dark; yk-themes=dark' }))).toBe('system');
    });

    test('the cookie goes on the broadest domain the browser accepts, else the host alone', () => {
        for (const [host, domain] of [
            ['cloud.yukibana.dev', 'yukibana.dev'],
            ['yukibana.dev', 'yukibana.dev'],
            ['docs.school.example.co.uk', 'example.co.uk'],
            ['me.github.io', 'me.github.io'],
            ['localhost', null],
            ['192.168.1.5', '192.168.1.5'],
        ] as const) {
            const b = browser({ host });
            b.install();
            writeTheme('dark');
            expect(b.domain(), host).toBe(domain);
            expect(b.cookie(), host).toBe('yk-theme=dark');
        }
    });

    test('a browser that drops every cookie keeps the choice in localStorage', () => {
        const b = browser({ cookies: 'refuse' });
        b.install();
        writeTheme('dark');
        expect(booted(browser({ stored: b.stored() ?? '' }))).toBe('dark');
    });

    test('blocked cookies or storage never throw, and show the system scheme', () => {
        for (const cookies of ['keep', 'refuse', 'throw'] as const)
            for (const storage of ['keep', 'refuse', 'throw'] as const) {
                const b = browser({ cookies, storage, cookie: 'yk-theme=dark', stored: 'dark' });
                expect(() => booted(b)).not.toThrow();
                expect(() => writeTheme('light')).not.toThrow();
            }
        expect(booted(browser({ cookies: 'throw', storage: 'throw', cookie: 'yk-theme=dark', stored: 'dark' }))).toBe('system');
    });
});

test('a fixed theme sets data-theme, System removes it, and the switcher reads it back', () => {
    const b = browser();
    b.install();
    for (const theme of ['dark', 'light', 'system'] as const) {
        applyTheme(theme);
        expect(b.theme()).toBe(theme === 'system' ? null : theme);
        expect(readTheme()).toBe(theme);
    }
});

test('the boot script is plain old JavaScript that cannot close the script element it sits in', () => {
    expect(themeBoot()).not.toMatch(/=>|\blet\b|\bconst\b|`|<\//);
});
