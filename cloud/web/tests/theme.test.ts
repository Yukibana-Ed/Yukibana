import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { THEME_KEY, applyTheme, parseTheme, readTheme, writeTheme } from '../src/lib/theme';

/** A storage that keeps what it is given, or one that throws on every call (a private window, blocked site data). */
function memory(): Storage {
    const items = new Map<string, string>();
    return {
        getItem: (k: string) => items.get(k) ?? null,
        setItem: (k: string, v: string) => void items.set(k, v),
        removeItem: (k: string) => void items.delete(k),
    } as Storage;
}
const refusing = {
    getItem() {
        throw new Error('SecurityError');
    },
    setItem() {
        throw new Error('QuotaExceededError');
    },
    removeItem() {
        throw new Error('SecurityError');
    },
} as unknown as Storage;

/** The page's root and its two theme-color metas, as much of the DOM as the theme touches. */
function page() {
    const metas = [
        { dataset: { scheme: 'light' }, media: '(prefers-color-scheme: light)' },
        { dataset: { scheme: 'dark' }, media: '(prefers-color-scheme: dark)' },
    ];
    const attributes = new Map<string, string>();
    const document = { querySelectorAll: () => metas } as unknown as Document;
    const root = {
        ownerDocument: document,
        setAttribute: (k: string, v: string) => void attributes.set(k, v),
        removeAttribute: (k: string) => void attributes.delete(k),
    } as unknown as HTMLElement;
    Object.assign(document, { documentElement: root });
    return { root, document, metas, theme: () => attributes.get('data-theme') ?? null, media: () => metas.map(m => m.media) };
}

test('only "light" and "dark" are choices; anything else stored is the system theme', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    for (const junk of [null, undefined, '', 'system', 'Dark', 'blue', 1]) expect(parseTheme(junk)).toBe('system');
});

test('a choice is kept, and choosing System forgets it', () => {
    const storage = memory();
    expect(readTheme(storage)).toBe('system');
    writeTheme(storage, 'dark');
    expect(storage.getItem(THEME_KEY)).toBe('dark');
    expect(readTheme(storage)).toBe('dark');
    writeTheme(storage, 'system');
    expect(storage.getItem(THEME_KEY)).toBeNull();
    expect(readTheme(storage)).toBe('system');
});

test('a storage that throws, or none at all, never breaks the page', () => {
    expect(readTheme(refusing)).toBe('system');
    expect(() => writeTheme(refusing, 'light')).not.toThrow();
    expect(readTheme(undefined)).toBe('system');
    expect(() => writeTheme(undefined, 'dark')).not.toThrow();
});

test('a fixed theme sets data-theme and turns on its own theme-color; System puts both back', () => {
    const p = page();
    applyTheme(p.root, 'dark');
    expect(p.theme()).toBe('dark');
    expect(p.media()).toEqual(['not all', 'all']);
    applyTheme(p.root, 'light');
    expect(p.theme()).toBe('light');
    expect(p.media()).toEqual(['all', 'not all']);
    applyTheme(p.root, 'system');
    expect(p.theme()).toBeNull();
    expect(p.media()).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']);
});

/** app.html's inline copy, run as the browser runs it, must do what applyTheme does for every stored value. */
const html = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');
const boot = /<script id="theme-boot">([\s\S]*?)<\/script>/.exec(html)?.[1];

test('app.html applies the stored theme before the first paint, exactly as applyTheme would', () => {
    expect(boot).toBeDefined();
    for (const stored of [null, 'light', 'dark', 'junk']) {
        const storage = memory();
        if (stored !== null) storage.setItem(THEME_KEY, stored);
        const inline = page();
        runInNewContext(boot!, { localStorage: storage, document: inline.document });
        const expected = page();
        applyTheme(expected.root, readTheme(storage));
        expect([inline.theme(), inline.media()], `stored ${stored}`).toEqual([expected.theme(), expected.media()]);
    }
});

test("app.html's inline copy survives a storage that throws", () => {
    const inline = page();
    expect(() => {
        runInNewContext(boot!, { localStorage: refusing, document: inline.document });
    }).not.toThrow();
    expect(inline.theme()).toBeNull();
});
