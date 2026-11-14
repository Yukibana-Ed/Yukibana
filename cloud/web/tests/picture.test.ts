import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PICTURE_MAX_BYTES, pictureProblem, webpShape } from '../src/lib/picture/webp.js';
import { cover, panned, zoomed, type View } from '../src/lib/picture/crop.js';

// Made by libwebp (Pillow 12): one of each kind of first chunk a browser's encoder writes.
const file = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, 'base64'));
const LOSSY_256 = file(
    'UklGRrgAAABXRUJQVlA4IKwAAADwEACdASoAAQABPm02mUmkIyKhICgAgA2JaW7hdrEbQArN2vFych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2Tj+AA/v9YeHf///YO//84D//nAf0UAAAAAAAAAAAA',
);
const LOSSLESS_256 = file('UklGRiQAAABXRUJQVlA4TBgAAAAv/8A/AAdQxlJUq/8BAEX6/58i+p/6338=');
const ALPHA_256 = file(
    'UklGRuYAAABXRUJQVlA4WAoAAAAQAAAA/wAA/wAAQUxQSBIAAAABB1CyiAgAKNL//xTR/9T//gNWUDggrgAAAPAQAJ0BKgABAAE+bTaZSaQjIqEgKACADYlpbuF2sRtACs3a8XJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOP4AD+/0cZ9N6///Owf/BH/x75arOCuJCgAAAAAAAAAA==',
);
const WIDE = file(
    'UklGRqYAAABXRUJQVlA4IJoAAABwEACdASosAcgAPm02mUmkIyKhICgAgA2JaW7hdrEbQAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJwoAD+/9S4AAAAAAAAAAAA',
);
const TINY = file('UklGRjIAAABXRUJQVlA4ICYAAADQAgCdASogACAAPm00lkekIyIhKAgAgA2JaQAAPaOgAP77eMAAAA==');

/** `bytes` with `patch` written over it at `at`. */
const patched = (bytes: Uint8Array, at: number, patch: number[]): Uint8Array => {
    const out = bytes.slice();
    out.set(patch, at);
    return out;
};

test('a profile picture is read from the headers of each kind of WebP a browser writes', () => {
    assert.deepEqual(webpShape(LOSSY_256), { width: 256, height: 256 });
    assert.deepEqual(webpShape(LOSSLESS_256), { width: 256, height: 256 });
    assert.deepEqual(webpShape(ALPHA_256), { width: 256, height: 256 }, 'a picture with transparency, in the extended format');
    assert.deepEqual(webpShape(WIDE), { width: 300, height: 200 });
});

test('a square still WebP from the browser is stored, and anything else is refused with a reason', () => {
    const cases: [string, Uint8Array, RegExp | null][] = [
        ['a lossy picture', LOSSY_256, null],
        ['a lossless picture', LOSSLESS_256, null],
        ['a picture with transparency', ALPHA_256, null],
        ['nothing', new Uint8Array(0), /No picture/],
        ['a PNG', file('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), /not a WebP/],
        ['a WebP with something appended', new Uint8Array([...LOSSY_256, 0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e]), /does not end where the file does/],
        ['a WebP cut short', LOSSY_256.slice(0, 100), /does not end where the file does/],
        ['an animation', patched(ALPHA_256, 20, [(ALPHA_256[20] ?? 0) | 0x02]), /animation/],
        ['a picture that is not square', WIDE, /300×200 pixels/],
        ['a picture too small to show sharply', TINY, /32 pixels wide/],
        ['a picture far larger than the browser makes', patched(LOSSY_256, 26, [0x00, 0x04, 0x00, 0x04]), /1024 pixels wide/],
        ['a file over the size limit', new Uint8Array(PICTURE_MAX_BYTES + 1), /larger than 128 KiB/],
        ['a container holding something else', patched(LOSSY_256, 12, [0x49, 0x43, 0x43, 0x50]), /holds no image/],
    ];
    for (const [what, bytes, expected] of cases) {
        const said = pictureProblem(bytes);
        if (expected === null) assert.equal(said, null, what);
        else assert.match(said ?? 'accepted', expected, what);
    }
});

test('a picture chosen for cropping starts as the largest centred square, filling the frame', () => {
    assert.deepEqual(cover(1200, 800), { zoom: 1, x: 200, y: 0, side: 800 });
    assert.deepEqual(cover(600, 900), { zoom: 1, x: 0, y: 150, side: 600 });
    assert.deepEqual(cover(500, 500), { zoom: 1, x: 0, y: 0, side: 500 });
});

test('dragging the picture never shows anything outside it', () => {
    const start: View = cover(1200, 800);
    assert.deepEqual(panned(start, 1200, 800, 50, 0), { zoom: 1, x: 150, y: 0, side: 800 }, 'dragging right shows more of the left');
    assert.deepEqual(panned(start, 1200, 800, 1000, 0), { zoom: 1, x: 0, y: 0, side: 800 }, 'and stops at the left edge');
    assert.deepEqual(panned(start, 1200, 800, -1000, 40), { zoom: 1, x: 400, y: 0, side: 800 }, 'and at the right one, with no room to move vertically');
});

test('zooming keeps the centre of the frame where it was, and stays between the whole picture and a fifth of it', () => {
    const start = cover(1000, 1000);
    assert.deepEqual(zoomed(start, 1000, 1000, 2), { zoom: 2, x: 250, y: 250, side: 500 });
    assert.deepEqual(zoomed(start, 1000, 1000, 50), { zoom: 5, x: 400, y: 400, side: 200 }, 'never closer than five times');
    assert.deepEqual(zoomed(zoomed(start, 1000, 1000, 2), 1000, 1000, 0.1), { zoom: 1, x: 0, y: 0, side: 1000 }, 'never further out than the whole picture');
    const corner = panned(zoomed(start, 1000, 1000, 4), 1000, 1000, 10_000, 10_000);
    assert.deepEqual(zoomed(corner, 1000, 1000, 1.25), { zoom: 1.25, x: 0, y: 0, side: 800 }, 'zooming out from a corner pulls the frame back inside');
});
