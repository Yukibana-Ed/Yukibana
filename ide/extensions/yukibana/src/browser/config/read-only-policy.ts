/**
 * SPDX-License-Identifier: MIT
 */
import { URI } from '@theia/core';
import { injectable } from '@theia/core/shared/inversify';
import { match } from '@theia/monaco-editor-core/esm/vs/base/common/glob';

/**
 * Says which files the student may not change: the config's `readOnly` globs, relative to the workspace root.
 *
 * Nothing is read-only until {@link ConfigProvider} has applied a config with a root, nor when the workspace has no
 * root or its `yukibana.json` is missing or not valid.
 *
 * The globs are matched with Monaco's glob, not the `matcher` the CLI assembles a submission with, and the two differ:
 * here a pattern naming a directory (`src/test`) does not cover the files under it, so the IDE lets the student edit
 * files whose changes the assembly then replaces. Write `src/test/**` to be read the same by both. They differ in a
 * second way too: the assembly always takes `yukibana.json` from the teacher's version (the CLI's `protectedPaths`),
 * but here it is read-only only if `readOnly` names it, so the student can edit a file the assembly then replaces.
 */
@injectable()
export class ReadOnlyPolicy {
    /** The root the globs are relative to, or `undefined` while nothing is read-only. */
    protected root?: URI;
    /** The globs, as the expression Monaco's `match` takes: each glob mapped to `true`. */
    protected patterns: Record<string, boolean> = {};

    /**
     * Makes the files under `root` matching `readOnly` the read-only ones, in place of those before; with `root`
     * `undefined`, none is.
     */
    update(root: URI | undefined, readOnly: readonly string[]): void {
        this.root = root;
        this.patterns = Object.fromEntries(readOnly.map(p => [p, true]));
    }

    /**
     * Returns `true` iff `resource` is under the root and its path relative to it matches one of the globs.
     *
     * The root itself, and anything outside it, is never read-only: Monaco's glob matches the empty path for `**`, `*`
     * and `**\/*`, so the root is excluded explicitly rather than left to the patterns.
     */
    isFileReadonly(resource: URI): boolean {
        if (!this.root) {
            return false;
        }
        const rel = this.root.relative(resource);
        if (!rel) {
            return false;
        }
        const path = rel.toString();
        return path !== '' && !!match(this.patterns, path);
    }
}
