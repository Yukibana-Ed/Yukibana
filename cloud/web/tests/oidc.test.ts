import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SignJWT, createLocalJWKSet, errors, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import { isHttpError } from '@sveltejs/kit';
import { GITHUB_ACTIONS_ISSUER, ciIdentityOf, isCiToken, issuerOf, verifyCiToken } from '../src/lib/server/oidc.js';

const AUDIENCE = 'https://cloud.yukibana.dev';
const SHA = '0123456789abcdef0123456789abcdef01234567';

/** The claims GitHub puts in a token for a tag push, as far as they matter here. */
const CLAIMS = {
    repository_id: '123456',
    repository_owner_id: '789',
    repository: 'ada/course',
    ref: 'refs/tags/v1',
    sha: SHA,
    event_name: 'push',
} as const;

test("a token's claims become an identity only when every one is there, and only for a push or a manual run", () => {
    assert.deepEqual(ciIdentityOf(CLAIMS), { repositoryId: '123456', ownerId: '789', repository: 'ada/course', ref: 'refs/tags/v1', sha: SHA, event: 'push' });
    assert.equal((ciIdentityOf({ ...CLAIMS, event_name: 'workflow_dispatch' }) as { event: string }).event, 'workflow_dispatch');
    assert.equal((ciIdentityOf({ ...CLAIMS, sha: SHA.toUpperCase() }) as { sha: string }).sha, SHA, 'a commit is lowercased');
    const refused: [Record<string, unknown>, RegExp][] = [
        [{ ...CLAIMS, event_name: 'pull_request' }, /a pull_request run does not publish/],
        [{ ...CLAIMS, event_name: 'pull_request_target' }, /pull_request_target run does not publish/],
        [{ ...CLAIMS, event_name: 'issue_comment' }, /issue_comment run does not publish/],
        [{ ...CLAIMS, event_name: undefined }, /event_name/],
        [{ ...CLAIMS, repository_id: undefined }, /repository_id/],
        [{ ...CLAIMS, repository_id: 123456 }, /repository_id/],
        [{ ...CLAIMS, repository_id: '12a' }, /repository_id/],
        [{ ...CLAIMS, repository_owner_id: '' }, /repository_owner_id/],
        [{ ...CLAIMS, repository: 'course' }, /repository claim/],
        [{ ...CLAIMS, ref: 'main' }, /ref claim/],
        [{ ...CLAIMS, sha: 'abc1234' }, /sha claim/],
    ];
    for (const [claims, why] of refused) {
        const got = ciIdentityOf(claims);
        assert.equal(typeof got, 'string', JSON.stringify(claims));
        assert.match(got as string, why);
    }
});

/** A local key pair standing in for GitHub's, and a signer of tokens with it. */
async function issuer(): Promise<{
    keys: ReturnType<typeof createLocalJWKSet>;
    sign: (claims: Record<string, unknown>, opts?: { iss?: string; aud?: string; exp?: number }) => Promise<string>;
}> {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'local', alg: 'RS256' };
    const keys = createLocalJWKSet({ keys: [jwk] });
    const sign = async (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: number } = {}): Promise<string> =>
        new SignJWT(claims)
            .setProtectedHeader({ alg: 'RS256', kid: 'local' })
            .setIssuer(opts.iss ?? GITHUB_ACTIONS_ISSUER)
            .setAudience(opts.aud ?? AUDIENCE)
            .setIssuedAt()
            .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 300)
            .sign(privateKey);
    return { keys, sign };
}

test('a token GitHub signed for this registry says which repository, ref and commit the job runs at', async () => {
    const { keys, sign } = await issuer();
    assert.deepEqual(await verifyCiToken(await sign(CLAIMS), AUDIENCE, keys), ciIdentityOf(CLAIMS));
});

test('a token for another registry is refused with the audience this one expects', async () => {
    const { keys, sign } = await issuer();
    assert.equal(
        await verifyCiToken(await sign(CLAIMS, { aud: 'https://other.example' }), AUDIENCE, keys),
        `this token is for https://other.example; this registry expects ${AUDIENCE}`,
    );
    assert.match((await verifyCiToken(await sign(CLAIMS, { aud: `${AUDIENCE}/` }), AUDIENCE, keys)) as string, /expects https:\/\/cloud\.yukibana\.dev$/);
});

test('a token from another issuer, an expired one, one signed by another key and one that is not a JWT are refused', async () => {
    const { keys, sign } = await issuer();
    const stranger = await issuer();
    const now = Math.floor(Date.now() / 1000);
    assert.match((await verifyCiToken(await sign(CLAIMS, { iss: 'https://ghe.example.com/_services/token' }), AUDIENCE, keys)) as string, /accepts only https:\/\/token\.actions/);
    assert.match((await verifyCiToken(await sign(CLAIMS, { exp: now - 10 }), AUDIENCE, keys)) as string, /expired/);
    assert.equal(await verifyCiToken(await stranger.sign(CLAIMS), AUDIENCE, keys), 'its signature is not valid');
    assert.match((await verifyCiToken('not.a.jwt', AUDIENCE, keys)) as string, /not a JWT/);
    // A token that claims GitHub but signs with a shared secret: never accepted, whatever the key set holds.
    const forged = `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ ...CLAIMS, iss: GITHUB_ACTIONS_ISSUER, aud: AUDIENCE, exp: now + 60 })).toString('base64url')}.sig`;
    assert.match((await verifyCiToken(forged, AUDIENCE, keys)) as string, /not RS256/);
});

test('a verified token from a pull request publishes nothing', async () => {
    const { keys, sign } = await issuer();
    assert.match((await verifyCiToken(await sign({ ...CLAIMS, event_name: 'pull_request' }), AUDIENCE, keys)) as string, /pull_request run does not publish/);
});

test('a JWT from any issuer but Supabase Auth is routed to CI, so that a GitHub Enterprise job is told which issuer is accepted, and nothing else is', async () => {
    const { sign } = await issuer();
    assert.equal(isCiToken(await sign(CLAIMS)), true);
    assert.equal(isCiToken(await sign(CLAIMS, { iss: 'https://token.actions.githubusercontent.com/school' })), true);
    assert.equal(isCiToken(await sign(CLAIMS, { iss: 'https://school.ghe.com/_services/token' })), true);
    assert.equal(isCiToken(await sign(CLAIMS, { iss: 'https://example.supabase.co/auth/v1' })), false);
    assert.equal(isCiToken(`yk_${'0'.repeat(64)}`), false);
    assert.equal(isCiToken('garbage'), false);
    assert.equal(issuerOf('garbage'), null);
});

test('a GitHub that cannot serve its key set is a 503 the job may retry, never a refusal that blames the token', async () => {
    const { keys, sign } = await issuer();
    const token = await sign(CLAIMS);
    const failing =
        (thrown: Error): JWTVerifyGetKey =>
        () =>
            Promise.reject(thrown);
    for (const thrown of [
        new errors.JOSEError('Expected 200 OK from the JSON Web Key Set HTTP response'),
        new errors.JWKSInvalid('JSON Web Key Set malformed'),
        new errors.JWKSTimeout(),
        new TypeError('fetch failed'),
    ]) {
        const answer = await verifyCiToken(token, AUDIENCE, failing(thrown)).then(
            v => v,
            (e: unknown) => e,
        );
        assert.ok(isHttpError(answer, 503), `${thrown.constructor.name}: ${JSON.stringify(answer)}`);
    }
    // A key set that is there but holds no key for the token is the token's fault.
    const noMatch: JWTVerifyGetKey = (header, t) => keys({ ...header, kid: 'another' }, t);
    assert.equal(await verifyCiToken(token, AUDIENCE, noMatch), 'it is not signed by a key GitHub publishes');
});
