/**
 * SPDX-License-Identifier: MIT
 */
// Fails when a dependency's license is not one this project accepts, or when the IDE bundles a plugin nobody reviewed.
// The rules are below: licenses accepted for any package, the packages accepted under another license (each with why),
// and the plugins, each with the license it was reviewed under (and why, when that is another license). Every npm
// package counts, development tools too: the Worker's bundle is built from devDependencies, and a list split by use
// would need to be maintained by hand.
//
//   pnpm install && pnpm download:plugins && node .github/scripts/licenses.mts
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Licenses accepted for any package, as SPDX identifiers: the permissive ones. */
export const ALLOWED: ReadonlySet<string> = new Set([
    '0BSD',
    'Apache-2.0',
    'BlueOak-1.0.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'CC0-1.0',
    'ISC',
    'MIT',
    'MIT-0',
    'Python-2.0',
    'Unlicense',
]);

/** An npm package, or a family of them, accepted under one license that {@link ALLOWED} does not cover. */
export interface Exception {
    /** The package's name, or a prefix of names followed by `*` (`@theia/*`). */
    readonly pattern: string;
    /** The license accepted, exactly as pnpm reports it: another one fails the check again. */
    readonly license: string;
    /** Why it is accepted. */
    readonly reason: string;
}

/** The packages accepted under a license {@link ALLOWED} does not cover. */
export const EXCEPTIONS: readonly Exception[] = [
    { pattern: '@theia/*', license: 'EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0', reason: 'Theia, used under the EPL-2.0' },
    { pattern: '@theia/*', license: 'EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0', reason: 'Theia, used under the EPL-2.0' },
    { pattern: 'jschardet', license: 'LGPL-2.1+', reason: 'shipped unminified as its own file, so it can be replaced' },
    { pattern: '@vscode/codicons', license: 'CC-BY-4.0', reason: 'icons, credited in the notices' },
    { pattern: 'font-awesome', license: '(OFL-1.1 AND MIT)', reason: 'the font under the OFL, the code under MIT' },
    { pattern: 'khroma', license: 'Unknown', reason: 'MIT, by its license file; its package.json has no license field' },
    { pattern: 'buffers', license: 'Unknown', reason: "MIT/X11 by its README; a build tool of Theia's CLI, not shipped" },
    { pattern: 'union', license: 'Unknown', reason: "MIT, by its license file; a build tool of Theia's CLI, not shipped" },
    { pattern: 'chainsaw', license: 'MIT/X11', reason: 'MIT under an older name' },
    { pattern: 'jsonify', license: 'Public Domain', reason: 'public domain' },
    { pattern: 'truncate-utf8-bytes', license: 'WTFPL', reason: "permissive; electron-builder's, not shipped" },
    { pattern: 'lightningcss*', license: 'MPL-2.0', reason: "Vite's CSS tool, which runs at build time and is not shipped" },
    { pattern: '@img/sharp-libvips-*', license: 'LGPL-3.0-or-later', reason: "wrangler's local image tool, not shipped" },
];

/** A bundled plugin, or a family of them, with the license it was reviewed under. */
export interface ReviewedPlugin {
    /** The plugin's directory under `ide/plugins` (`publisher.name`, lowercase), or a prefix of them followed by `*`. */
    readonly pattern: string;
    /** The license it is used under, as an SPDX expression. */
    readonly license: string;
    /** Its manifest's `license` field, exactly; `undefined` when the manifest has none. A different one fails. */
    readonly manifest: string | undefined;
    /** Why `license` is accepted although {@link ALLOWED} does not satisfy it; absent when it does. */
    readonly reason?: string;
}

/**
 * The plugins the IDE bundles, as `pnpm download:plugins` resolves ide/package.json's `theiaPlugins`: the extension
 * packs pull in their members, which is why there are more here than there.
 */
export const PLUGINS: readonly ReviewedPlugin[] = [
    { pattern: 'vscode.*', license: 'MIT', manifest: 'SEE LICENSE IN LICENSE-vscode.txt' },
    { pattern: 'ms-ceintl.vscode-language-pack-fr', license: 'MIT', manifest: 'SEE MIT LICENSE IN LICENSE.md' },
    { pattern: 'ms-vscode.js-debug', license: 'MIT', manifest: 'MIT' },
    { pattern: 'ms-vscode.vscode-js-profile-table', license: 'MIT', manifest: 'MIT' },
    {
        pattern: 'redhat.java',
        license: 'EPL-2.0',
        manifest: 'EPL-2.0',
        reason: 'the Java language server, shipped as its own plugin; the Eclipse JustJ JRE it bundles is GPL-2.0-only WITH Classpath-exception-2.0',
    },
    { pattern: 'scala-lang.scala', license: 'MIT', manifest: 'SEE LICENSE IN LICENSE.md' },
    { pattern: 'scalameta.metals', license: 'Apache-2.0', manifest: 'Apache-2.0' },
    { pattern: 'vscjava.vscode-gradle', license: 'MIT', manifest: 'SEE LICENSE IN LICENSE.md' },
    { pattern: 'vscjava.vscode-java-debug', license: 'MIT', manifest: 'SEE LICENSE IN LICENSE.txt' },
    { pattern: 'vscjava.vscode-java-dependency', license: 'MIT', manifest: 'MIT' },
    { pattern: 'vscjava.vscode-java-pack', license: 'MIT', manifest: 'MIT' },
    { pattern: 'vscjava.vscode-java-test', license: 'MIT', manifest: undefined },
    { pattern: 'vscjava.vscode-maven', license: 'MIT', manifest: 'MIT' },
];

/** `true` iff `name` is `pattern`, or starts with what precedes a trailing `*` in it. */
export function matches(pattern: string, name: string): boolean {
    return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

/**
 * `true` iff a license expression is satisfied by licenses in `accepted`: an `OR` needs one side allowed, an `AND` both
 * (`AND` binding tighter, parentheses grouping). `X WITH Y` is one license, and a single word that is not a known
 * identifier (`Unknown`, `MIT/X11`) is a license of that name.
 *
 * - Requires: `expression` is well formed (throws otherwise): no unbalanced parenthesis, no dangling operator, and no
 *   words side by side that are not joined by `AND`, `OR` or `WITH` (`Public Domain`).
 */
export function satisfies(expression: string, accepted: ReadonlySet<string>): boolean {
    const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
    let at = 0;
    const peek = (): string | undefined => tokens[at];
    const fail = (): never => {
        throw new Error(`not a license expression: ${JSON.stringify(expression)}`);
    };
    const license = (): boolean => {
        const token = tokens[at++];
        if (token === '(') {
            const inner = or();
            if (tokens[at++] !== ')') {
                fail();
            }
            return inner;
        }
        if (token === undefined || token === ')' || token === 'AND' || token === 'OR' || token === 'WITH') {
            return fail();
        }
        let name = token;
        if (peek() === 'WITH') {
            at++;
            const exception = tokens[at++];
            if (exception === undefined || exception === '(' || exception === ')') {
                fail();
            }
            name = `${name} WITH ${exception}`;
        }
        return accepted.has(name);
    };
    const and = (): boolean => {
        let all = license();
        while (peek() === 'AND') {
            at++;
            all = license() && all;
        }
        return all;
    };
    const or = (): boolean => {
        let any = and();
        while (peek() === 'OR') {
            at++;
            any = and() || any;
        }
        return any;
    };
    const result = or();
    if (at !== tokens.length) {
        fail();
    }
    return result;
}

/** One npm package with the license pnpm reports for it. */
export interface PackageLicense {
    /** The package's name. */
    readonly name: string;
    /** The installed versions. */
    readonly versions: readonly string[];
    /** Its license field as pnpm reports it: an SPDX expression, or `Unknown` when there is none. */
    readonly license: string;
}

/** Returns the problems with these packages' licenses, one line each; none when every one is accepted. */
export function packageProblems(packages: readonly PackageLicense[]): string[] {
    return packages.filter(p => !usable(p.name, p.license)).map(p => `${p.name}@${p.versions.join(', ')}: ${p.license}`);
}

/** `true` iff the package `name` may be used under `license`: {@link ALLOWED} satisfies it, or an exception names it. */
function usable(name: string, license: string): boolean {
    return allowed(license) || EXCEPTIONS.some(e => matches(e.pattern, name) && e.license === license);
}

/** `true` iff `license` is a license expression that {@link ALLOWED} satisfies. */
function allowed(license: string): boolean {
    try {
        return satisfies(license, ALLOWED);
    } catch {
        return false;
    }
}

/** A plugin as `pnpm download:plugins` unpacked it. */
export interface DownloadedPlugin {
    /** Its directory under `ide/plugins`. */
    readonly id: string;
    /** Its manifest's `license` field; `undefined` when there is none. */
    readonly manifest: string | undefined;
}

/**
 * Returns the problems with the downloaded plugins, one line each: a plugin that `reviews` (in the check,
 * {@link PLUGINS}) does not name, one reviewed under a license that {@link ALLOWED} does not satisfy and without a
 * reason, a manifest whose license changed since the review, or a plugin of ide/package.json's `theiaPlugins`
 * (`declared`) that was not downloaded.
 */
export function pluginProblems(downloaded: readonly DownloadedPlugin[], declared: readonly string[], reviews: readonly ReviewedPlugin[]): string[] {
    const problems = downloaded.flatMap(plugin => {
        const review = reviews.find(p => matches(p.pattern, plugin.id));
        if (review === undefined) {
            return [`${plugin.id}: not reviewed (its manifest says ${JSON.stringify(plugin.manifest)}); add it to PLUGINS once its license is checked`];
        }
        return [
            ...(allowed(review.license) || review.reason !== undefined ? [] : [`${plugin.id}: reviewed as ${review.license}, which is not allowed and has no reason`]),
            ...(review.manifest === plugin.manifest ? [] : [`${plugin.id}: its manifest says ${JSON.stringify(plugin.manifest)}, reviewed as ${JSON.stringify(review.manifest)}`]),
        ];
    });
    // The download of a tarball of several plugins (vscode-builtin-extensions) unpacks under other names.
    const missing = declared.filter(id => id.includes('.') && !downloaded.some(p => p.id === id.toLowerCase()));
    return [...problems, ...missing.map(id => `${id}: listed in ide/package.json but not in ide/plugins; run pnpm download:plugins`)];
}

/** Returns every installed package with its license, from `pnpm licenses list`. */
function installedPackages(): PackageLicense[] {
    const json: unknown = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '-r', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    if (typeof json !== 'object' || json === null) {
        throw new Error('pnpm licenses list printed something other than an object');
    }
    return Object.values(json).flatMap((group: unknown) => {
        if (!Array.isArray(group)) {
            throw new Error('pnpm licenses list printed a license without a list of packages');
        }
        return group.map((entry: unknown) => {
            if (
                typeof entry !== 'object' ||
                entry === null ||
                !('name' in entry && typeof entry.name === 'string') ||
                !('license' in entry && typeof entry.license === 'string') ||
                !('versions' in entry && Array.isArray(entry.versions) && entry.versions.every(v => typeof v === 'string'))
            ) {
                throw new Error(`pnpm licenses list printed an unexpected package: ${JSON.stringify(entry)}`);
            }
            return { name: entry.name, license: entry.license, versions: entry.versions };
        });
    });
}

/** Returns the plugins in `ide/plugins`, failing if there are none. */
function downloadedPlugins(): DownloadedPlugin[] {
    const dir = 'ide/plugins';
    const ids = existsSync(dir) ? readdirSync(dir) : [];
    if (ids.length === 0) {
        throw new Error(`${dir} is empty: run pnpm download:plugins first`);
    }
    return ids.map(id => {
        const manifest: unknown = JSON.parse(readFileSync(path.join(dir, id, 'extension', 'package.json'), 'utf8'));
        if (typeof manifest !== 'object' || manifest === null) {
            throw new Error(`${id}: its package.json is not an object`);
        }
        const license = 'license' in manifest ? manifest.license : undefined;
        if (license !== undefined && typeof license !== 'string') {
            throw new Error(`${id}: its license field is not a string`);
        }
        return { id, manifest: license };
    });
}

/** Returns the plugin ids that ide/package.json's `theiaPlugins` lists. */
function declaredPlugins(): string[] {
    const manifest: unknown = JSON.parse(readFileSync('ide/package.json', 'utf8'));
    if (typeof manifest !== 'object' || manifest === null || !('theiaPlugins' in manifest) || typeof manifest.theiaPlugins !== 'object' || manifest.theiaPlugins === null) {
        throw new Error('ide/package.json has no theiaPlugins object');
    }
    return Object.keys(manifest.theiaPlugins);
}

if (import.meta.main) {
    const packages = installedPackages();
    const plugins = downloadedPlugins();
    const problems = [...packageProblems(packages), ...pluginProblems(plugins, declaredPlugins(), PLUGINS)];
    if (problems.length > 0) {
        console.error(`Licenses not accepted (see .github/scripts/licenses.mts):\n${problems.map(p => `  ${p}`).join('\n')}`);
        process.exit(1);
    }
    console.log(`${packages.length} npm packages and ${plugins.length} plugins, all under accepted licenses`);
}
