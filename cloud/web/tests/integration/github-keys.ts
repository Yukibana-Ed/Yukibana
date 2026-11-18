// Preloaded (Node strips its types) into the integration suite's app (NODE_OPTIONS=--import) by the
// suites that publish over HTTP with a CI token: GitHub's key set, which the
// Worker fetches to verify a GitHub Actions OIDC token (#lib/server/oidc),
// is answered from YUKIBANA_TEST_GITHUB_JWKS instead, a key set the suite
// made and signs its tokens with. Every other request goes out unchanged.
// Only the test harness loads this; the app's code knows nothing of it, so
// nothing in production can be pointed at another key set.

import { env } from 'node:process';

const JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const jwks: string | undefined = env['YUKIBANA_TEST_GITHUB_JWKS'];

if (jwks !== undefined && jwks !== '') {
    const real = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        if (url === JWKS_URL) return new Response(jwks, { status: 200, headers: { 'content-type': 'application/json' } });
        return real(input, init);
    };
}
