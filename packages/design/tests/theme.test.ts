import { afterEach, describe, expect, test, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { applyTheme, onSystemChange, readTheme, themeBoot, writeTheme } from '../src/theme.ts';

/** As much of a browser as the theme touches: a cookie jar behind `document.cookie`, a localStorage and the root's
 *  attributes. Either store can drop what it is given ('refuse', a host the cookie is not for) or throw ('throw',
 *  blocked site data). */
function browser(options: { cookie?: string; stored?: string; cookies?: 'keep' | 'refuse' | 'throw'; storage?: 'keep' | 'refuse' | 'throw' } = {}) {
    let jar = options.cookie ?? '';
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
            if (options.cookies !== 'refuse') jar = value.split(';')[0] ?? '';
        },
        documentElement: {
            setAttribute: (k: string, v: string) => void attributes.set(k, v),
            removeAttribute: (k: string) => void attributes.delete(k),
        },
    };
    const localStorage = {
        getItem: (k: string) => (options.storage === 'throw' ? blocked() : (items.get(k) ?? null)),
        setItem: (k: string, v: string) => (options.storage === 'throw' ? blocked() : options.storage === 'refuse' ? undefined : void items.set(k, v)),
    };
    return {
        globals: { document, localStorage },
        /** Makes this the page the module's functions see. */
        install() {
            vi.stubGlobal('document', document);
            vi.stubGlobal('localStorage', localStorage);
        },
        cookie: () => jar,
        stored: () => items.get('yk-theme'),
        theme: () => attributes.get('data-theme') ?? null,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the choice', () => {
    test('is written to the shared cookie and to localStorage, and read back', () => {
        const b = browser();
        b.install();
        expect(readTheme()).toBe('system');
        for (const theme of ['dark', 'light', 'system'] as const) {
            writeTheme(theme);
            expect(b.stored()).toBe(theme);
            expect(readTheme()).toBe(theme);
        }
        expect(b.cookie()).toBe('yk-theme=system');
    });

    test('the cookie wins over localStorage, which is used without one', () => {
        browser({ cookie: 'a=1; yk-theme=dark; b=2', stored: 'light' }).install();
        expect(readTheme()).toBe('dark');
        browser({ cookie: 'a=1', stored: 'light' }).install();
        expect(readTheme()).toBe('light');
    });

    test('a garbled value counts as nothing', () => {
        for (const junk of ['Dark', 'darker', '"dark"', '']) {
            browser({ cookie: `yk-theme=${junk}`, stored: junk }).install();
            expect(readTheme(), junk).toBe('system');
            browser({ cookie: `yk-theme=${junk}`, stored: 'dark' }).install();
            expect(readTheme(), junk).toBe('dark');
        }
        browser({ cookie: 'xyk-theme=dark; yk-themes=dark' }).install();
        expect(readTheme()).toBe('system');
    });

    test('on a host the cookie is not for, localStorage alone keeps it', () => {
        browser({ cookies: 'refuse' }).install();
        writeTheme('dark');
        expect(readTheme()).toBe('dark');
    });

    test('blocked cookies or storage never throw', () => {
        for (const cookies of ['keep', 'refuse', 'throw'] as const)
            for (const storage of ['keep', 'refuse', 'throw'] as const) {
                browser({ cookies, storage, cookie: 'yk-theme=dark', stored: 'dark' }).install();
                expect(() => writeTheme('light')).not.toThrow();
                expect(['light', 'dark', 'system']).toContain(readTheme());
            }
        browser({ cookies: 'throw', storage: 'throw' }).install();
        expect(readTheme()).toBe('system');
    });
});

test('a fixed theme sets data-theme, and System removes it', () => {
    const b = browser();
    b.install();
    applyTheme('dark');
    expect(b.theme()).toBe('dark');
    applyTheme('light');
    expect(b.theme()).toBe('light');
    applyTheme('system');
    expect(b.theme()).toBeNull();
});

describe('the system scheme', () => {
    test('tells the listener when it changes, until it is stopped', () => {
        const listeners = new Set<(event: { matches: boolean }) => void>();
        vi.stubGlobal('matchMedia', () => ({
            addEventListener: (_: string, l: (event: { matches: boolean }) => void) => void listeners.add(l),
            removeEventListener: (_: string, l: (event: { matches: boolean }) => void) => void listeners.delete(l),
        }));
        const heard: string[] = [];
        const stop = onSystemChange(scheme => heard.push(scheme));
        for (const l of listeners) l({ matches: true });
        for (const l of listeners) l({ matches: false });
        stop();
        expect(listeners.size).toBe(0);
        expect(heard).toEqual(['dark', 'light']);
    });

    test('a browser without matchMedia, or with an old media query list, never throws', () => {
        for (const matchMedia of [undefined, () => ({})]) {
            vi.stubGlobal('matchMedia', matchMedia);
            let stop = (): void => {};
            expect(() => (stop = onSystemChange(() => {}))).not.toThrow();
            expect(stop).not.toThrow();
        }
    });
});

describe('the boot script', () => {
    test('does exactly what applyTheme(readTheme()) does, and never throws', () => {
        for (const cookie of [undefined, 'yk-theme=dark', 'yk-theme=light', 'yk-theme=system', 'a=1; yk-theme=junk', 'yk-theme', '=;;'])
            for (const stored of [undefined, 'dark', 'light', 'system', 'junk'])
                for (const cookies of ['keep', 'throw'] as const)
                    for (const storage of ['keep', 'throw'] as const) {
                        const situation = { cookies, storage, ...(cookie === undefined ? {} : { cookie }), ...(stored === undefined ? {} : { stored }) };
                        const inline = browser(situation);
                        expect(() => {
                            runInNewContext(themeBoot(), inline.globals);
                        }, JSON.stringify(situation)).not.toThrow();
                        const expected = browser(situation);
                        expected.install();
                        applyTheme(readTheme());
                        expect(inline.theme(), JSON.stringify(situation)).toBe(expected.theme());
                    }
    });

    test('is plain old JavaScript that cannot close the script element it sits in', () => {
        expect(themeBoot()).not.toMatch(/=>|\blet\b|\bconst\b|`|<\//);
    });
});
