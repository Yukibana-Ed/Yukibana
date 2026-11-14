import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

// The theme and its boot script are the design system's, and tested there (packages/design/tests/theme.test.ts).
// What is the cloud's: that app.html leaves the hook one place to put the script, inside a script element.

test('every page has a place for the theme boot script, before anything paints', () => {
    const html = readFileSync(new URL('../src/app.html', import.meta.url), 'utf8');
    expect(html.split('%yk.theme%')).toHaveLength(2);
    expect(html).toMatch(/<head>[\s\S]*<script>\s*%yk\.theme%\s*<\/script>[\s\S]*%sveltekit\.head%/);
});
