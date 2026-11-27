/** Compiles `tests/ts6/` with TypeScript 6 against the emitted declarations in `lib/`, as `cloud/web`'s
 *  `svelte-check` reads them: the package is written for TypeScript 7, and the two can disagree about a complex
 *  conditional type (`Exactly`, `Numbered`, `Steps`). Run by `typecheck`, after `prepare` has built `lib/`. */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tsc = fileURLToPath(import.meta.resolve('typescript-6/bin/tsc'));
const project = fileURLToPath(new URL('../tests/ts6/tsconfig.json', import.meta.url));
try {
    execFileSync(process.execPath, [tsc, '--project', project], { stdio: 'inherit' });
} catch {
    console.error("The package's declarations do not compile under TypeScript 6, which cloud/web's svelte-check uses.");
    process.exit(1);
}
