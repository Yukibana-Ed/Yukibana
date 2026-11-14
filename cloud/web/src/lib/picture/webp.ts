/** What a profile picture is, as bytes: the one rule the browser that makes a picture and the Worker that stores it
 *  share.
 *
 *  The browser crops and encodes; the Worker transforms nothing, and so checks that what arrived is what the browser
 *  was meant to make before it stores it under the person's name. A file that merely says it is an image is not enough:
 *  the bytes are served back to everyone who shares an edition with its owner. This module is imported by the page
 *  before any picture is chosen, so it holds no more than the rule; the cropper and the encoder are loaded on demand.
 */

/** The width and height, in pixels, of every picture the browser makes. More than twice the largest size a page draws
 *  one at (96 CSS pixels, on the account page), so it is sharp on a high-density screen, and still a few kilobytes. */
export const PICTURE_SIZE = 256;

/** The smallest and largest side, in pixels, a stored picture may have. Wider than `PICTURE_SIZE` alone, so that a
 *  change of `PICTURE_SIZE` does not refuse the pictures of a browser that loaded the page before it. */
export const PICTURE_SIDE = { min: 64, max: 512 } as const;

/** The most bytes a stored picture may have. A 256-pixel photograph at the quality the browser uses is 10 to 40 KiB;
 *  this leaves room for a noisy one and refuses anything that is not the browser's output. */
export const PICTURE_MAX_BYTES = 128 * 1024;

/** The first bytes of a file the encoder made, read by `webpProblem`. */
export interface WebpShape {
    /** Width and height in pixels, each at least 1. */
    readonly width: number;
    readonly height: number;
}

/** `true` iff `bytes` spell the four ASCII letters `fourcc` at `at`. */
const ascii = (bytes: Uint8Array, at: number, fourcc: string): boolean => Array.from({ length: fourcc.length }, (_, i) => bytes[at + i] === fourcc.charCodeAt(i)).every(Boolean);
const u16 = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24 = (b: Uint8Array, at: number): number => u16(b, at) | ((b[at + 2] ?? 0) << 16);
const u32 = (b: Uint8Array, at: number): number => (u24(b, at) | ((b[at + 3] ?? 0) << 24)) >>> 0;

/** Returns the dimensions of the still WebP image `bytes`, or a sentence saying why it is not one: not a RIFF WebP
 *  container, a RIFF length other than the file's (trailing bytes are refused, so the file is nothing but the image),
 *  an animation, or a first chunk that is none of `VP8 `, `VP8L` and `VP8X`. Reads only the headers: whether the
 *  image data then decodes is the browser's to find out, and a picture that does not decode shows as the initial. */
export function webpShape(bytes: Uint8Array): WebpShape | string {
    if (bytes.byteLength < 30 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return 'It is not a WebP image.';
    if (u32(bytes, 4) + 8 !== bytes.byteLength) return 'Its WebP container does not end where the file does.';
    if (ascii(bytes, 12, 'VP8 ')) {
        // A lossy key frame: a 3-byte frame tag, the start code 9d 01 2a, then 14-bit width and height.
        if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return 'Its lossy image has no key frame.';
        return { width: u16(bytes, 26) & 0x3fff, height: u16(bytes, 28) & 0x3fff };
    }
    if (ascii(bytes, 12, 'VP8L')) {
        // A lossless image: the signature 0x2f, then width - 1 and height - 1 in 14 bits each.
        if (bytes[20] !== 0x2f) return 'Its lossless image has no signature.';
        const bits = u32(bytes, 21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (ascii(bytes, 12, 'VP8X')) {
        // The extended format (an image with an alpha channel, or metadata): flags, 3 reserved bytes, then width - 1
        // and height - 1 in 24 bits each.
        if (((bytes[20] ?? 0) & 0x02) !== 0) return 'It is an animation.';
        return { width: u24(bytes, 24) + 1, height: u24(bytes, 27) + 1 };
    }
    return 'Its WebP container holds no image.';
}

/** Returns why `bytes` may not be stored as a profile picture, as a sentence for the person who chose it, or null
 *  when it may: a still WebP image (`webpShape`) of at most `PICTURE_MAX_BYTES`, square, with sides within
 *  `PICTURE_SIDE`. */
export function pictureProblem(bytes: Uint8Array): string | null {
    if (bytes.byteLength === 0) return 'No picture was sent.';
    if (bytes.byteLength > PICTURE_MAX_BYTES) return `The picture is larger than ${PICTURE_MAX_BYTES / 1024} KiB.`;
    const shape = webpShape(bytes);
    if (typeof shape === 'string') return `The picture was not made by this page. ${shape}`;
    if (shape.width !== shape.height) return `The picture is ${shape.width}×${shape.height} pixels, and a profile picture is square.`;
    if (shape.width < PICTURE_SIDE.min || shape.width > PICTURE_SIDE.max) {
        return `The picture is ${shape.width} pixels wide, and a profile picture is ${PICTURE_SIDE.min} to ${PICTURE_SIDE.max}.`;
    }
    return null;
}
