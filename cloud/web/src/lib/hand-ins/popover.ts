/** Where a row's menu opens.
 *
 *  The menu is a popover, drawn in the browser's top layer: inside the
 *  table it was clipped by the scrolling box around it, and on the last row
 *  it made that box scroll instead of showing over the page. A popover
 *  escapes every box, so it has to be told where its button is.
 */

/** A rectangle in viewport pixels, as `getBoundingClientRect` gives one. */
export interface Box {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
}

/** The gap between the button and its menu, in pixels. */
const GAP = 4;

/** The viewport position for a menu `width` × `height` opened by a button
 *  at `anchor`, in a viewport `viewportWidth` × `viewportHeight`: right-
 *  aligned under the button, or above it when there is no room below and
 *  more above, and never past the left edge. */
export function menuPosition(anchor: Box, width: number, height: number, viewportWidth: number, viewportHeight: number): { top: number; left: number } {
    const below = anchor.bottom + GAP;
    const above = anchor.top - GAP - height;
    const fitsBelow = below + height <= viewportHeight;
    const top = fitsBelow || above < 0 ? below : above;
    const left = Math.max(0, Math.min(anchor.right - width, viewportWidth - width));
    return { top, left };
}
