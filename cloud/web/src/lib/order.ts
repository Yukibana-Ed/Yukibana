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

/** One of `movesTo`'s moves: a `Move`, and the item it moves. */
export interface Step<T> extends Move<T> {
    /** The item moved, which sits between `after` and `before` in `items`. */
    readonly item: T;
}

/** Returns the moves, in the order to send them, that turn `list` into
 *  `wanted`: each a `move` of the list as the moves before it left it, so
 *  its neighbours are the ones the server will have. Empty when the two
 *  already agree. Without changing either list.
 *
 *  Only the order of items in both lists is decided: an item only in
 *  `list` (one someone else added since) stays where it is, between
 *  whichever items it ends up between, and an item only in `wanted` (one
 *  since deleted) is skipped. Not the fewest moves: at most one per item of
 *  `wanted`, each placing the next item of `wanted` after the one before
 *  it, so a single misplaced item costs one move. Items are compared with
 *  `===` and must each appear once in `list`. */
export function movesTo<T>(list: readonly T[], wanted: readonly T[]): Step<T>[] {
    const present = new Set(list);
    const goal = wanted.filter(w => present.has(w));
    const inGoal = new Set(goal);
    const moves: Step<T>[] = [];
    let items: readonly T[] = list;
    for (const [k, g] of goal.entries()) {
        const shared = items.filter(i => inGoal.has(i));
        if (shared[k] === g) continue;
        // goal[0..k-1] lead `shared` already, so `g` is further down: it
        // goes just after goal[k-1], or just before the first shared item.
        const from = items.indexOf(g);
        const to = k === 0 ? items.indexOf(shared[0] as T) : items.indexOf(goal[k - 1] as T) + 1;
        const m = move(items, from, to);
        if (m === null) continue;
        moves.push({ ...m, item: g });
        items = m.items;
    }
    return moves;
}
