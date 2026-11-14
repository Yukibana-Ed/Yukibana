import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { applyTheme, readTheme, themeBoot } from '@yukibana/design/theme';

// The theme itself and its boot script are the design system's, and tested there (packages/design/tests/theme.test.ts).
// What is the cloud's: that app.html carries that boot script, and that it shows on this page what the account menu's
// switcher reads back.

/** A page: its cookie, its localStorage and its root, as much as the theme touches. */
function page(cookie: string, stored: string | undefined) {
    const attributes = new Map<string, string>();
    const document = {
        cookie,
        documentElement: {
            setAttribute: (k: string, v: string) => void attributes.set(k, v),
            removeAttribute: (k: string) => void attributes.delete(k),
        },
    };
    const localStorage = { getItem: (k: string) => (k === 'yk-theme' ? (stored ?? null) : null), setItem: () => {} };
    return { globals: { document, localStorage }, theme: () => attributes.get('data-theme') ?? null };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

const html = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');
const boot = /<script id="theme-boot">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
const words = (js: string): string => js.replace(/\s+/g, '');

test("app.html's boot script is the design system's", () => {
    expect(words(boot), 'paste themeBoot() from @yukibana/design/theme into app.html\'s <script id="theme-boot">').toBe(words(themeBoot()));
});

test('app.html applies the choice before the first paint, exactly as the switcher reads it back', () => {
    for (const cookie of ['', 'yk-theme=dark', 'yk-theme=light', 'yk-theme=system', 'yk-theme=junk'])
        for (const stored of [undefined, 'dark', 'light', 'junk']) {
            const inline = page(cookie, stored);
            runInNewContext(boot, inline.globals);
            const expected = page(cookie, stored);
            vi.stubGlobal('document', expected.globals.document);
            vi.stubGlobal('localStorage', expected.globals.localStorage);
            applyTheme(readTheme());
            expect(inline.theme(), `${cookie} ${String(stored)}`).toBe(expected.theme());
        }
});
