import { afterEach, describe, expect, test, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { THEME_BOOT, chooseTheme, readTheme } from '../src/theme.ts';

/** The public suffixes the fake browser refuses a cookie for, as a real one does from the Public Suffix List. */
const PUBLIC_SUFFIXES = new Set(['dev', 'io', 'github.io', 'uk', 'co.uk', 'example']);

/** As much of a browser as the theme touches, modelled, not real: a page on `host`, a one-cookie jar behind
 *  `document.cookie` that refuses a Domain the host cannot set (or every cookie, 'refuse'), a localStorage that can
 *  throw (blocked site data), and the root's attributes. */
function browser(options: { host?: string; cookie?: string; stored?: string; cookies?: 'refuse'; storage?: 'throw' } = {}) {
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
            return jar;
        },
        set cookie(value: string) {
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
        setItem: (k: string, v: string) => (options.storage === 'throw' ? blocked() : void items.set(k, v)),
    };
    const globals = { document, localStorage, location: { hostname } };
    return {
        globals,
        /** Makes this the page the module's functions see. */
        install() {
            for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value);
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
    runInNewContext(THEME_BOOT, b.globals);
    b.install();
    return readTheme();
}

describe('the choice', () => {
    test('is shown, written to the shared cookie and to localStorage, and the next page shows it', () => {
        const b = browser();
        expect(booted(b)).toBe('system');
        for (const theme of ['dark', 'light', 'system'] as const) {
            b.install();
            chooseTheme(theme);
            expect(b.theme()).toBe(theme === 'system' ? null : theme);
            expect(readTheme()).toBe(theme);
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
            chooseTheme('dark');
            expect(b.domain(), host).toBe(domain);
            expect(b.cookie(), host).toBe('yk-theme=dark');
        }
    });

    test('a browser that drops every cookie keeps the choice in localStorage', () => {
        const b = browser({ cookies: 'refuse' });
        b.install();
        chooseTheme('dark');
        expect(booted(browser({ stored: b.stored() ?? '' }))).toBe('dark');
    });

    test('blocked site data never throws: the cookie still works, and without it the system scheme shows', () => {
        const b = browser({ storage: 'throw' });
        expect(booted(b)).toBe('system');
        expect(() => chooseTheme('dark')).not.toThrow();
        expect(booted(browser({ storage: 'throw', cookie: b.cookie() }))).toBe('dark');
        expect(booted(browser({ storage: 'throw', cookies: 'refuse' }))).toBe('system');
    });
});

test('the boot script is plain old JavaScript that cannot close the script element it sits in', () => {
    expect(THEME_BOOT).not.toMatch(/=>|\blet\b|\bconst\b|`|<\//);
});
