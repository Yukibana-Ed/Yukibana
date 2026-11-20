import { describe, expect, test } from 'vitest';
import { schemaFiles } from '@yukibana/project-schema';
import { GET } from '../src/routes/schema/yukibana.json/+server.js';
import { GET as versioned } from '../src/routes/schema/[format]/[file]/+server.js';

describe('the yukibana.json schema', () => {
    test('is served at the URL it names as its id, to anyone, as a JSON Schema', async () => {
        const response = await GET({} as Parameters<typeof GET>[0]);
        expect(response.headers.get('content-type')).toBe('application/schema+json');
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        const schema = (await response.json()) as { $id: string; required: string[] };
        expect(schema.$id).toBe('https://cloud.yukibana.dev/schema/yukibana.json');
        expect(schema.required).toEqual(['version', 'kind']);
    });
});

describe('the versioned schemas', () => {
    const get = (format: string, file: string) => versioned({ params: { format, file } } as unknown as Parameters<typeof versioned>[0]);

    test('each version is served at the URL its $id names, to anyone, as the package commits it', async () => {
        for (const f of schemaFiles()) {
            const [format = '', file = ''] = f.path.split('/');
            const response = await get(format, file);
            expect(response.headers.get('content-type')).toBe('application/schema+json');
            expect(response.headers.get('access-control-allow-origin')).toBe('*');
            expect(response.headers.get('cache-control')).toBe(f.released ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
            const text = await response.text();
            expect(text).toBe(f.text);
            expect((JSON.parse(text) as { $id: string }).$id).toBe(`https://cloud.yukibana.dev/schema/${f.path}`);
        }
    });

    test('a version this registry does not know, or another name, is a 404', () => {
        for (const [format, file] of [
            ['yukibana', 'v0.json'],
            ['yukibana', 'v99.json'],
            ['yukibana', 'v1'],
            ['other', 'v1.json'],
            ['..', 'package.json'],
        ])
            expect(() => get(format ?? '', file ?? '')).toThrow(expect.objectContaining({ status: 404 }));
    });
});
