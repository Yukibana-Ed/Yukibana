import { test, expect } from 'vitest';
import { menuPosition } from '../src/lib/hand-ins/popover';

const button = (top: number) => ({ top, bottom: top + 30, left: 900, right: 1000 });

test('a row menu opens under its button, right edges aligned', () => {
    expect(menuPosition(button(100), 200, 40, 1280, 800)).toEqual({ top: 134, left: 800 });
});

test('on the last row it opens above its button rather than off the bottom of the window', () => {
    expect(menuPosition(button(760), 200, 40, 1280, 800)).toEqual({ top: 716, left: 800 });
});

test('a window too short for either side keeps it below, and no menu starts left of the window', () => {
    expect(menuPosition(button(10), 200, 900, 1280, 800).top).toBe(44);
    expect(menuPosition({ top: 100, bottom: 130, left: 0, right: 50 }, 200, 40, 1280, 800).left).toBe(0);
});
