import { describe, expect, test } from 'vitest';
import { highlight, type Language } from '#lib/highlight.ts';

const WORKFLOW = `name: Publish to Yukibana
on:
  push:
    tags: ['*']

jobs:
  publish:
    steps:
      - uses: actions/checkout@v4
      - uses: Yukibana-Ed/Yukibana/action@main
        with:
          token: \${{ secrets.YUKIBANA_TOKEN }}`;

/** The colour of the run that is exactly `text` on line `line`, or undefined when no run is. */
const colourOf = (code: string, language: Language, line: number, text: string) => highlight(code, language)[line]?.find(t => t.text === text)?.color;

describe('a snippet on a project page', () => {
    test.each<[string, string, Language]>([
        ['a workflow', WORKFLOW, 'yaml'],
        ['a command and its output', '$ yukibana publish --project 1234\nPublished release 3', 'shell'],
        ['a secret', 'yk_abc: "not yaml"', 'text'],
    ])('loses no character and no line when coloured: %s', (_, code, language) => {
        expect(
            highlight(code, language)
                .map(l => l.map(t => t.text).join(''))
                .join('\n'),
        ).toBe(code);
    });

    test('draws a workflow’s keys and strings in the docs site’s colours', () => {
        expect(colourOf(WORKFLOW, 'yaml', 0, 'name')).toBe('var(--yk-code-function)');
        expect(highlight(WORKFLOW, 'yaml')[3]?.some(t => t.text.includes('*') && t.color === 'var(--yk-code-string)')).toBe(true);
    });

    test('shows a command’s prompt apart from the command, so copying never takes it', () => {
        const [line] = highlight('$ yukibana publish', 'shell');
        expect(line?.[0]).toEqual({ text: '$ ', color: null, prompt: true });
        expect(line?.slice(1).some(t => t.prompt)).toBe(false);
    });

    test('leaves output and plain text in the block’s own ink', () => {
        expect(highlight('$ x\nPublished', 'shell')[1]).toEqual([{ text: 'Published', color: null, prompt: false }]);
        expect(highlight('yk_secret', 'text')).toEqual([[{ text: 'yk_secret', color: null, prompt: false }]]);
    });
});
