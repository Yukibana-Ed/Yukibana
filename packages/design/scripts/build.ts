/** Writes the generated files: css/tokens.css from the token files, css/base.css from its parts in css/base/, and
 *  js/theme.js with js/theme.d.ts from src/theme.ts (by tsconfig.theme.json). `--check` writes nothing and exits non-zero
 *  if a committed file is not what its sources build to, which is how CI catches a source edited without a rebuild. */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_PARTS, concatBase } from '../src/base.ts';
import { compileCss, parseTokens } from '../src/tokens.ts';

const at = (p: string): string => fileURLToPath(new URL('../' + p, import.meta.url));
const read = (p: string): unknown => JSON.parse(readFileSync(at(p), 'utf8'));

const unlisted = readdirSync(at('css/base')).filter(f => !(BASE_PARTS as readonly string[]).includes(f.replace(/\.css$/, '')));
if (unlisted.length > 0) {
    console.error(`css/base/ holds ${unlisted.join(', ')}, which src/base.ts does not list in BASE_PARTS. Add each to the list, in cascade order.`);
    process.exit(1);
}

/** The theme module as TypeScript compiles it, into a scratch directory that is removed again. */
function compileTheme(): [string, string][] {
    const out = mkdtempSync(join(tmpdir(), 'yk-theme-'));
    try {
        // The package exports no path to its CLI, so it is found beside the package.json it does export, where its
        // `bin` puts it.
        const tsc = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc');
        execFileSync(process.execPath, [tsc, '-p', at('tsconfig.theme.json'), '--outDir', out], { stdio: 'inherit' });
        return ['theme.js', 'theme.d.ts'].map(f => [`js/${f}`, readFileSync(join(out, f), 'utf8')]);
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
}

const outputs: [string, string][] = [
    ['css/tokens.css', compileCss(parseTokens(read('tokens/base.tokens.json')), parseTokens(read('tokens/dark.tokens.json')))],
    ['css/base.css', concatBase(BASE_PARTS.map(name => ({ name, css: readFileSync(at(`css/base/${name}.css`), 'utf8') })))],
    ...compileTheme(),
];

if (process.argv.includes('--check')) {
    let stale = false;
    for (const [path, css] of outputs) {
        let current = '';
        try {
            current = readFileSync(at(path), 'utf8');
        } catch {}
        if (current !== css) {
            console.error(`${path} is not what its sources build to. Run \`pnpm --filter @yukibana/design build\` and commit the result.`);
            stale = true;
        }
    }
    if (stale) process.exit(1);
} else for (const [path, css] of outputs) writeFileSync(at(path), css);
