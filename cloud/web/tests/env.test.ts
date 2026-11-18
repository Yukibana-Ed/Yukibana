import { test, expect } from 'vitest';
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

test('a GitHub App with all three values is on, with or without a template', () => {
    expect(configOf({ ...base, ...app }).github).toEqual({ clientId: 'Iv1.abc', clientSecret: 'shh', slug: 'yukibana-cloud', template: null });
    expect(configOf({ ...base, ...app, GITHUB_TEMPLATE: 'Yukibana-Ed/template' }).github?.template).toBe('Yukibana-Ed/template');
});

test('a GitHub App configured by halves fails naming what is missing, rather than staying off without a word', () => {
    expect(() => configOf({ ...base, GITHUB_APP_CLIENT_ID: 'Iv1.abc' })).toThrow('GITHUB_APP_CLIENT_SECRET and GITHUB_APP_SLUG is not set');
    expect(() => configOf({ ...base, ...app, GITHUB_APP_SLUG: '' })).toThrow(/^GITHUB_APP_SLUG is not set/);
});

test('a template that is not an owner/name is refused', () => {
    expect(() => configOf({ ...base, ...app, GITHUB_TEMPLATE: 'https://github.com/a/b' })).toThrow('GITHUB_TEMPLATE');
});
