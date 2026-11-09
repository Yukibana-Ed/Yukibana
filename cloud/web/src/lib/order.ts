/** Moving one item of an ordered list, as drag and drop does: the new order
 *  for the screen, and the two neighbours the server needs to place the
 *  moved item between (see app.move_project). Pure.
 */

/** One move, worked out.
 *
 *  Invariant: `after` and `before` are the moved item's neighbours in
 *  `items`, so at most one of them is null (both only in a list of one,
 *  which `move` never answers for). */
export interface Move<T> {
    /** The list after the move. */
    readonly items: T[];
    /** The item it now follows, or null at the start. */
    readonly after: T | null;
    /** The item it now precedes, or null at the end. */
    readonly before: T | null;
}

/** Returns the move of the item at `from` to index `to` of the result,
 *  without changing `list`; null when nothing moves (`from === to`,
 *  either index not a whole number, which includes NaN, or either index
 *  outside `list`, which includes every index of an empty list). A
 *  fractional index used to pass the bounds checks and answer a move with
 *  no neighbours at all. Indices are of `list` and of the result alike: moving down by one
 *  is `to = from + 1`. Neighbours are compared by position, not by value,
 *  so a list with repeated items moves the one at `from`. */
export function move<T>(list: readonly T[], from: number, to: number): Move<T> | null {
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return null;
    const items = [...list];
    const [moved] = items.splice(from, 1);
    if (moved === undefined) return null;
    items.splice(to, 0, moved);
    return { items, after: items[to - 1] ?? null, before: items[to + 1] ?? null };
}
