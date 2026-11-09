/**
 * SPDX-License-Identifier: MIT
 */
import { inject, injectable } from '@theia/core/shared/inversify';
import { randomUUIDv7 } from 'node:crypto';
import { IdentityProviderContribution } from '@yukibana/ide-ext/lib/node/identity-service';
import { CloudAuth } from '../common/cloud-protocol';
import { CloudAuthImpl } from './cloud-auth';

/**
 * The identity telemetry is sent under: the logged-in account's name, when there is one, with an id that stays the
 * same until the backend restarts.
 */
@injectable()
export class CloudIdentityProvider implements IdentityProviderContribution {
    /** The provider's name, sent with every identity it gives. */
    readonly ID: string = 'cloud';
    /** Where this provider ranks among identity providers: the highest priority wins, and the default's is lower. */
    readonly PRIORITY: number = 100;

    /** Who is logged in; an instance of its own, with no window to call back, which `whoAmI` needs none of. */
    @inject(CloudAuthImpl) protected readonly auth!: CloudAuth;

    /** A UUIDv7 made when the backend starts: tells this run apart, and is all that is sent when nobody is logged in. */
    protected readonly staticRandomId: string = randomUUIDv7();

    /**
     * Returns `<name>/<id>`, the name being the first of the account's full name, GitHub login and email that is set
     * and not empty, or only the id when nobody is logged in or the account has none of them.
     *
     * Rejects when the registry cannot be asked who is logged in (see {@link CloudAuth.whoAmI}).
     */
    async getIdentity(): Promise<string> {
        const account = await this.auth.whoAmI();
        if (account === undefined) {
            return this.staticRandomId;
        }
        // An empty full name is skipped like a missing one, so a GitHub login or email still names the account
        const name = [account.fullName, account.githubLogin, account.email].find(n => !!n);
        if (name !== undefined && name !== null) {
            return `${name}/${this.staticRandomId}`;
        }
        return this.staticRandomId;
    }
}
