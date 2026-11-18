import { test, expect, vi } from 'vitest';
import { configOf } from '../src/lib/server/env';

const base: Cloudflare.Env = {
    DATABASE_URL: 'postgres://yukibana_app@db/postgres',
    PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    S3_ENDPOINT: 'https://s3.example',
    S3_BUCKET: 'b',
    S3_REGION: 'auto',
    S3_ACCESS_KEY_ID: 'id',
    S3_SECRET_ACCESS_KEY: 'secret',
    SUBMISSION_MAX_BYTES: '1024',
    RELEASE_MAX_BYTES: '2048',
};
const app = { GITHUB_APP_CLIENT_ID: 'Iv1.abc', GITHUB_APP_CLIENT_SECRET: 'shh', GITHUB_APP_SLUG: 'yukibana-cloud' };

test('linking to GitHub is off when the GitHub App is not configured, and that is not an error', () => {
    expect(configOf(base).github).toBeNull();
    expect(configOf({ ...base, GITHUB_APP_CLIENT_ID: '', GITHUB_APP_CLIENT_SECRET: '', GITHUB_APP_SLUG: '' }).github).toBeNull();
});

test('a GitHub App with all three values is on', () => {
    expect(configOf({ ...base, ...app }).github).toEqual({ clientId: 'Iv1.abc', clientSecret: 'shh', slug: 'yukibana-cloud' });
});

test('a GitHub App configured by halves leaves linking off and says what is missing, without taking the rest of the site down', () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: string) => void logged.push(line));
    try {
        expect(configOf({ ...base, GITHUB_APP_CLIENT_ID: 'Iv1.abc', GITHUB_APP_SLUG: 'yukibana-cloud' }).github).toBeNull();
        expect(configOf({ ...base, ...app, GITHUB_APP_SLUG: '' }).github).toBeNull();
    } finally {
        spy.mockRestore();
    }
    expect(logged[0]).toMatch(/GITHUB_APP_CLIENT_SECRET is not set, so linking to GitHub is off/);
    expect(logged[1]).toMatch(/GITHUB_APP_SLUG is not set/);
});
