import { test, expect } from 'vitest';
import { REPOSITORY_NAME } from '../src/lib/server/github';
import { TEMPLATES, useTemplateUrl } from '../src/lib/templates';

test('every recommended template names a GitHub repository, once', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0);
    for (const t of TEMPLATES) expect(t.repository).toMatch(REPOSITORY_NAME);
    expect(new Set(TEMPLATES.map(t => t.repository.toLowerCase())).size).toBe(TEMPLATES.length);
});

test("a teacher is sent to GitHub's own page for making a repository from the template", () => {
    expect(useTemplateUrl({ name: 'Scala', repository: 'Yukibana-Ed/scala-project-template', description: '' })).toBe(
        'https://github.com/Yukibana-Ed/scala-project-template/generate',
    );
});
