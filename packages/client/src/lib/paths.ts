/** Paths inside a tree of entries, as the archives and the folders on disk need them. Pure. */

import type { Entry } from './tar.js';

/** Drops the top-level directory GitHub wraps a tarball in (`org-repo-sha/`). */
export function unwrap(entries: readonly Entry[]): Entry[] {
    const out: Entry[] = [];
    for (const e of entries) {
        const slash = e.path.indexOf('/');
        if (slash < 0) continue; // the wrapper directory itself
        out.push({ ...e, path: e.path.slice(slash + 1) });
    }
    return out;
}

/** Whether a symlink at `path` points outside the tree. A link to a hidden
 *  file would otherwise carry it out of the starter by another name, and a
 *  link in a student's submission would otherwise point a teacher's editor
 *  anywhere on their disk. */
export function escapes(path: string, target: string): boolean {
    if (target.startsWith('/')) return true;
    const parts = path.split('/').slice(0, -1);
    for (const seg of target.split('/')) {
        if (seg === '..') {
            if (parts.length === 0) return true;
            parts.pop();
        } else if (seg !== '.' && seg !== '') {
            parts.push(seg);
        }
    }
    return false;
}
