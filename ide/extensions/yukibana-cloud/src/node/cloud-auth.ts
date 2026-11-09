/**
 * SPDX-License-Identifier: MIT
 */
import { DisposableCollection, ILogger } from '@theia/core';
import { inject, injectable, named, postConstruct } from '@theia/core/shared/inversify';
import { AuthClient, CloudAccount, CloudAuth, LoginResult } from '../common/cloud-protocol';
import { CloudClient, isRefused } from './cloud-client';
import { CloudSessionManager, OpenLoginUrl } from './cloud-session-manager';

/**
 * One window's end of {@link CloudAuth}, made per connection: it does what the window asks with the IDE's one session,
 * opens login pages through that window, and tells it of every login change until the connection closes.
 */
@injectable()
export class CloudAuthImpl implements CloudAuth {
    /** The IDE's one session, shared by every window. */
    @inject(CloudSessionManager) protected readonly service!: CloudSessionManager;
    /** The registry, asked as whoever the session is for. */
    @inject(CloudClient) protected readonly cloudClient!: CloudClient;
    /** Where a session forgotten because the registry refused it is written down. */
    @inject(ILogger) @named('yukibana:CloudAuth') protected readonly logger!: ILogger;
    private client?: AuthClient;
    private readonly toDispose = new DisposableCollection();

    /**
     * Starts telling the window of every login change, for the life of this instance.
     *
     * The subscription is disposed only by {@link dispose}. An instance that never gets a window (the identity
     * provider's) is never disposed and keeps its subscription for as long as the backend runs; with no client, each
     * notification it receives does nothing.
     */
    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.service.onLoginChanged(() => this.client?.notifyLoginChanged()));
    }

    /** Makes `client` the window this connection reaches, or none if it is undefined; login pages open there. */
    setClient(client?: AuthClient): void {
        this.client = client;
    }

    /** Forgets the window and stops telling it of login changes; called when the connection closes. */
    dispose(): void {
        this.client = undefined;
        this.toDispose.dispose();
    }

    private readonly openLoginUrl: OpenLoginUrl = (url, code) => this.client?.openLoginUrl(url, code);

    /** Logs in, opening the page in this connection's window; see {@link CloudAuth.login}. */
    login(): Promise<LoginResult> {
        return this.service.login(this.openLoginUrl);
    }

    /** Logs in again before ending the current session; see {@link CloudAuth.switchAccount}. */
    switchAccount(): Promise<LoginResult> {
        return this.service.switchAccount(this.openLoginUrl);
    }

    /** Logs out of the IDE's one session, for every window; see {@link CloudAuth.logout}. */
    logout(): Promise<void> {
        return this.service.logout();
    }

    /**
     * Returns the account the registry knows the session as; see {@link CloudAuth.whoAmI}.
     *
     * Asks the registry only when a session is kept, so being logged out costs no request.
     */
    async whoAmI(): Promise<CloudAccount | undefined> {
        if (!(await this.service.isLoggedIn())) {
            return undefined;
        }
        try {
            return await this.cloudClient.me();
        } catch (e) {
            if (isRefused(e)) {
                // A session that can no longer be used would otherwise block logging in again
                this.logger.info(`Forgetting a session the registry no longer accepts: ${e.message}`);
                await this.service.forget();
                return undefined;
            }
            throw e;
        }
    }
}
