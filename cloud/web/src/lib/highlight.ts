import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import yaml from 'shiki/langs/yaml.mjs';
import shellscript from 'shiki/langs/shellscript.mjs';
import { ykShikiTheme } from './shiki-theme.ts';

/** Colours for the cloud's code blocks (#lib/CodeBlock.svelte), by Shiki with the docs site's theme, so a snippet here
 *  reads like the same snippet in the docs. Only the grammars the cloud shows are loaded, and the JavaScript regex
 *  engine rather than the WebAssembly one, so the Worker and the page carry no .wasm: highlighting is synchronous and
 *  runs the same during server rendering and in the browser. */

/** One run of a line in one colour. Joining a line's tokens' `text` gives the line back exactly. */
export interface Token {
    readonly text: string;
    /** A CSS colour, a `var(--yk-code-*)` from the theme; null for the block's own ink. */
    readonly color: string | null;
    /** Whether this is a shell prompt: drawn, but neither selectable nor copied (`.tok-prompt`). */
    readonly prompt: boolean;
}

/** The languages a block may be in: YAML (a workflow), a shell session (each line that starts with `$ ` is a command,
 *  any other line its output), or plain text. */
export type Language = 'yaml' | 'shell' | 'text';

const highlighter = createHighlighterCoreSync({
    themes: [ykShikiTheme],
    langs: [yaml, shellscript],
    engine: createJavaScriptRegexEngine(),
});

/** The theme's default ink, which a token in it is drawn with anyway; such tokens are given no colour of their own. */
const INK = 'var(--yk-code-ink)';

/** Returns `code` as lines of tokens, one array per line (split on `\n`, none dropped), each line's tokens joining
 *  back to the line exactly. */
export function highlight(code: string, language: Language): Token[][] {
    if (language === 'text') return code.split('\n').map(text => [{ text, color: null, prompt: false }]);
    if (language === 'yaml') return shiki(code, 'yaml');
    return code.split('\n').map(line => {
        if (!line.startsWith('$ ')) return [{ text: line, color: null, prompt: false }];
        const prompt: Token = { text: '$ ', color: null, prompt: true };
        return [prompt].concat(shiki(line.slice(2), 'shellscript')[0] ?? []);
    });
}

function shiki(code: string, lang: 'yaml' | 'shellscript'): Token[][] {
    return highlighter
        .codeToTokensBase(code, { lang, theme: 'yukibana' })
        .map(line => line.map(t => ({ text: t.content, color: t.color === undefined || t.color.toLowerCase() === INK ? null : t.color, prompt: false })));
}
