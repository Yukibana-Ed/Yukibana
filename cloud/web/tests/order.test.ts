import { test, expect } from 'vitest';
import { movesTo, type Step } from '../src/lib/order';

/** Plays `steps` from `list` as the server does: each item taken out and put between the neighbours it was sent with. */
function play(list: readonly string[], steps: readonly Step<string>[]): string[] {
    const items = [...list];
    for (const s of steps) {
        items.splice(items.indexOf(s.item), 1);
        items.splice(s.after === null ? items.indexOf(s.before as string) : items.indexOf(s.after) + 1, 0, s.item);
    }
    return items;
}

test('retrying an order the server already has sends nothing', () => {
    expect(movesTo(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
});

test('retrying puts one misplaced project back with one move', () => {
    const steps = movesTo(['a', 'b', 'c', 'd'], ['a', 'c', 'b', 'd']);
    expect(steps).toEqual([{ items: ['a', 'c', 'b', 'd'], item: 'c', after: 'a', before: 'b' }]);
});

test('retrying reaches the wanted order whatever order the server had', () => {
    const wanted = ['e', 'c', 'a', 'd', 'b'];
    for (const list of [['a', 'b', 'c', 'd', 'e'], ['b', 'e', 'd', 'c', 'a'], ['d', 'b', 'e', 'a', 'c']]) {
        const steps = movesTo(list, wanted);
        expect(steps.length).toBeLessThan(wanted.length);
        expect(steps.at(-1)?.items).toEqual(wanted);
        expect(play(list, steps)).toEqual(wanted);
    }
});

test('a project added or deleted since the refused move neither blocks a retry nor is moved by it', () => {
    // Someone else added "x" and deleted "z" in the meantime.
    const steps = movesTo(['b', 'x', 'a', 'c'], ['a', 'z', 'b', 'c']);
    expect(steps.map(s => s.item)).not.toContain('x');
    expect(steps.map(s => s.item)).not.toContain('z');
    expect(play(['b', 'x', 'a', 'c'], steps).filter(i => i !== 'x')).toEqual(['a', 'b', 'c']);
});
