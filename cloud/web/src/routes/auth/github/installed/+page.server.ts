import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { workerConfig } from '#lib/server/worker.ts';

/** Where a return from GitHub with no connection in flight lands, as when
 *  somebody installs the App from github.com: there is nothing to finish,
 *  only somewhere to go. Reads nothing; a 404 where the GitHub App is not
 *  configured. */
export const load: PageServerLoad = () => {
    if (workerConfig().github === null) error(404, 'This registry does not link projects to GitHub.');
    return {};
};
