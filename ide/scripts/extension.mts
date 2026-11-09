import * as fs from 'node:fs';
import path from 'node:path';

interface TemplateDirectory {
    readonly path: string;
}

interface TemplateFile {
    readonly path: string;
    readonly content: string | ((name: string) => string);
}

type TemplateEntry = TemplateDirectory | TemplateFile;

const EXTENSION_TEMPLATE: TemplateEntry[] = [
    {
        path: 'src',
    },
    {
        path: 'package.json',
        content: name => `
        {
          "name": "@yukibana/ide-${name}-ext",
          "keywords": [
            "theia-extension"
          ],
          "version": "0.0.0-dev",
          "license": "MIT",
          "files": [
            "lib",
            "src"
          ],
          "dependencies": {},
          "devDependencies": {
            "@yukibana/ide": "catalog:",
            "rimraf": "catalog:",
            "typescript": "catalog:"
          },
          "scripts": {
            "prepare": "tsc --build",
            "clean": "rimraf lib tsconfig.tsbuildinfo",
            "lint": "oxlint",
            "typecheck": "tsc --build"
          },
          "theiaExtensions": []
        }
        `,
    },
    {
        path: 'tsconfig.json',
        content: `
        {
          "extends": "@yukibana/ide/configs/base.tsconfig.json",
          "compilerOptions": {
            "rootDir": "src",
            "outDir": "lib"
          },
          "include": ["src"],
          "references": []
        }
        `,
    },
];

const LANG_EXTENSION_TEMPLATE: TemplateEntry[] = [
    {
        path: 'src',
    },
    {
        path: 'package.json',
        content: name => `
        {
          "name": "@yukibana/ide-${name}-lang-ext",
          "keywords": [
            "theia-extension",
            "language"
          ],
          "version": "0.0.0-dev",
          "license": "MIT",
          "files": [
            "lib",
            "src"
          ],
          "dependencies": {},
          "devDependencies": {
            "@yukibana/ide": "catalog:",
            "rimraf": "catalog:",
            "typescript": "catalog:"
          },
          "scripts": {
            "prepare": "tsc --build",
            "clean": "rimraf lib tsconfig.tsbuildinfo",
            "lint": "oxlint",
            "typecheck": "tsc --build"
          },
          "theiaExtensions": []
        }
        `,
    },
    {
        path: 'tsconfig.json',
        content: `
        {
          "extends": "@yukibana/ide/configs/base.tsconfig.json",
          "compilerOptions": {
            "rootDir": "src",
            "outDir": "lib"
          },
          "include": ["src"],
          "references": []
        }
        `,
    },
];

function dedent(content: string): string {
    const lines = content.split('\n');
    let dedentBy: number | undefined;

    for (const line of lines) {
        const indent = line.match(/^ */)?.[0]?.length ?? 0;
        if (indent !== 0 && (dedentBy === undefined || indent < dedentBy)) {
            dedentBy = indent;
        }
    }
    if (dedentBy === undefined) {
        return content;
    }
    for (const [i, line] of lines.entries()) {
        lines[i] = line.slice(dedentBy);
    }
    return lines.join('\n');
}

function removeExtraLines(content: string): string {
    return content.replace(/^\n+/, '').replace(/\n+$/, '\n');
}

function mkdir(dirPath: string): void {
    try {
        fs.mkdirSync(dirPath);
    } catch (e) {
        if (e.code !== 'EEXIST') {
            throw e;
        }
        // EEXIST is also what a regular file there gives; using it would fail later, inside writeFileSync, as ENOTDIR.
        if (!fs.statSync(dirPath).isDirectory()) {
            throw new Error(`${dirPath} exists and is not a directory`);
        }
    }
}

/**
 * Writes a new, empty Theia extension package into `rootPath`: `src/`, a `package.json` named
 * `@yukibana/ide-<name>-ext` (`@yukibana/ide-<name>-lang-ext`, keyworded `language`, when `lang`) and a `tsconfig.json`
 * extending the IDE's base config. It registers nothing: the package's `theiaExtensions` and the workspace's references
 * are left for the author.
 *
 * - Requires: the parent of `rootPath` exists. Not created: `fs.mkdirSync` throws `ENOENT` otherwise.
 * - Requires: `rootPath`, and `src/` inside it, are each a directory or do not exist. Enforced: something else there
 *   (a regular file) throws an `Error` naming the path, before anything is written into it.
 *
 * A `rootPath` or `src/` directory that already exists is used as it is, and the two files are overwritten without asking;
 * refusing an existing extension is the caller's job (`new:ext` in `cli.mts` refuses a non-empty directory unless
 * `--force`).
 */
export function initExtension(name: string, rootPath: string, lang: boolean): void {
    mkdir(rootPath);
    const template = lang ? LANG_EXTENSION_TEMPLATE : EXTENSION_TEMPLATE;
    template.forEach(entry => {
        const entryPath = path.join(rootPath, entry.path);
        if ('content' in entry) {
            const rawContent = typeof entry.content === 'function' ? entry.content(name) : entry.content;
            const content = removeExtraLines(dedent(rawContent));
            fs.writeFileSync(entryPath, content);
        } else {
            mkdir(entryPath);
        }
    });
}
