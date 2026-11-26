import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';
import { FOCUS_BOOT, POINTER_ATTRIBUTE } from '../src/focus.ts';

type Target = { tagName: string; isContentEditable?: boolean };

/** As much of a browser as the script touches, modelled: the root's attributes and the listeners it adds to window. */
function page() {
    const attributes = new Map<string, string>();
    const listeners = new Map<string, (e: unknown) => void>();
    const globals = {
        document: {
            documentElement: {
                setAttribute: (k: string, v: string) => void attributes.set(k, v),
                removeAttribute: (k: string) => void attributes.delete(k),
            },
        },
        addEventListener: (type: string, f: (e: unknown) => void) => void listeners.set(type, f),
    };
    runInNewContext(FOCUS_BOOT, globals);
    const fire = (type: string, e: unknown): void => listeners.get(type)?.(e);
    return {
        click: () => fire('pointerdown', {}),
        key: (key: string, target: Target) => fire('keydown', { key, target }),
        pointer: () => attributes.has(POINTER_ATTRIBUTE),
    };
}

const field: Target = { tagName: 'INPUT' };
const editor: Target = { tagName: 'DIV', isContentEditable: true };
const button: Target = { tagName: 'BUTTON' };
const body: Target = { tagName: 'BODY' };

describe('a focused field', () => {
    test('gets the ring until the person uses a pointer, so a page that never clicks looks as before', () => {
        expect(page().pointer()).toBe(false);
    });

    test('clicked into gets the border, and keeps it while the person types into it', () => {
        const p = page();
        p.click();
        expect(p.pointer()).toBe(true);
        for (const target of [field, editor, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }]) p.key('a', target);
        expect(p.pointer()).toBe(true);
    });

    test('reached with Tab gets the ring, even when Tab is pressed inside a field one clicked into', () => {
        const p = page();
        p.click();
        p.key('Tab', field);
        expect(p.pointer()).toBe(false);
    });

    test('focused by a shortcut pressed outside any field gets the ring', () => {
        for (const target of [button, body]) {
            const p = page();
            p.click();
            p.key('k', target);
            expect(p.pointer()).toBe(false);
        }
    });

    test('gets the border again on the next click', () => {
        const p = page();
        p.key('Tab', body);
        p.click();
        expect(p.pointer()).toBe(true);
    });
});
