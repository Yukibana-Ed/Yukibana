/** Where the square frame of the picture cropper sits on the chosen image: pure geometry, so that what the person
 *  sees and what is encoded are the same square, and so that it is tested without a browser.
 *
 *  Everything is in the image's own pixels, after its EXIF orientation is applied (`createImageBitmap` with
 *  `imageOrientation: 'from-image'`), never in screen pixels: the component converts a drag on screen with
 *  `side / frame width`.
 */

/** The largest zoom: the frame shows a fifth of the image's shorter side. Closer than that, a 256-pixel picture of a
 *  phone photo is mostly blur. */
export const MAX_ZOOM = 5;

/** The square of the image the frame shows. Invariant, for the image `width × height` it was made for: `side` is
 *  `min(width, height) / zoom`, `1 <= zoom <= MAX_ZOOM`, and the square lies inside the image
 *  (`0 <= x <= width - side`, `0 <= y <= height - side`), so the frame never shows anything outside it. */
export interface View {
    /** How many times closer than the whole shorter side. */
    readonly zoom: number;
    /** The square's left and top edges, and its side. */
    readonly x: number;
    readonly y: number;
    readonly side: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Returns the view of the image `width × height` whose square has `side` and is centred on (`cx`, `cy`) as far as
 *  the image allows. */
function centred(width: number, height: number, zoom: number, cx: number, cy: number): View {
    const side = Math.min(width, height) / zoom;
    return { zoom, x: clamp(cx - side / 2, 0, width - side), y: clamp(cy - side / 2, 0, height - side), side };
}

/** Returns the starting view of the image `width × height`: the largest square, centred.
 *
 *  - Requires: `width` and `height` are positive. */
export function cover(width: number, height: number): View {
    return centred(width, height, 1, width / 2, height / 2);
}

/** Returns `view` after the image was dragged by (`dx`, `dy`) image pixels, rightwards and downwards, so that the
 *  frame moves the other way; stopped at the image's edges.
 *
 *  - Requires: `view` is a view of the image `width × height`. */
export function panned(view: View, width: number, height: number, dx: number, dy: number): View {
    return { ...view, x: clamp(view.x - dx, 0, width - view.side), y: clamp(view.y - dy, 0, height - view.side) };
}

/** Returns `view` at `zoom`, clamped to 1 to `MAX_ZOOM`, keeping the centre of the frame where it was as far as the
 *  image allows.
 *
 *  - Requires: `view` is a view of the image `width × height`. */
export function zoomed(view: View, width: number, height: number, zoom: number): View {
    return centred(width, height, clamp(zoom, 1, MAX_ZOOM), view.x + view.side / 2, view.y + view.side / 2);
}
