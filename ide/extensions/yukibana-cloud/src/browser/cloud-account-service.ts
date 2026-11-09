/**
 * SPDX-License-Identifier: MIT
 */
import { Emitter, ILogger } from '@theia/core';
import { inject, injectable, named, postConstruct } from '@theia/core/shared/inversify';
import { CloudAccount, CloudAuth } from '../common/cloud-protocol';
import { AuthClientImpl } from './cloud-auth-client';

/**
 * What this window knows about who is logged in to the cloud registry, as the registry answered, not as the keystore
 * holds it: a stored session the registry no longer accepts is `logged-out`.
 *
 * States are plain data and compared by value, so two equal states are the same state.
 */
export type CloudAccountState =
    /** No answer yet: the first check has not finished. */
    | {
          /** The discriminant: `unknown`. */
          readonly kind: 'unknown';
      }
    /**
     * Nobody is logged in: no session is kept, or the one kept was refused by the registry or the Auth server and has
     * been forgotten.
     */
    | {
          /** The discriminant: `logged-out`. */
          readonly kind: 'logged-out';
      }
    /** The registry knows the session as `account`. */
    | {
          /** The discriminant: `logged-in`. */
          readonly kind: 'logged-in';
          /** The account the registry knows the session as. */
          readonly account: CloudAccount;
      }
    /** The last check failed, so nobody knows; the session may be fine. */
    | {
          /** The discriminant: `error`. */
          readonly kind: 'error';
          /** Why the check failed, as the error said it, for people to read. */
          readonly reason: string;
      };

/** Which cloud account this window is using, kept up to date across logins and logouts. */
@injectable()
export class CloudAccountService {
    /** The backend that asks the registry who is logged in. */
    @inject(CloudAuth) protected readonly auth!: CloudAuth;
    /** Where the backend says that someone logged in or out. */
    @inject(AuthClientImpl) protected readonly authClient!: AuthClientImpl;
    /** Where logins and failed checks are written down. */
    @inject(ILogger) @named('yukibana:CloudAccount') protected readonly logger!: ILogger;

    private _state: CloudAccountState = { kind: 'unknown' };
    private latestRefresh = 0;
    private inFlight?: Promise<CloudAccountState>;

    private readonly onDidChangeEmitter = new Emitter<CloudAccountState>();
    /** Fires with the new state whenever it changes by value; a check that answers the same state fires nothing. */
    readonly onDidChange = this.onDidChangeEmitter.event;

    /** Checks again whenever the backend says someone logged in or out, in this window or another. */
    @postConstruct()
    protected init(): void {
        this.authClient.onLoginChanged(() => {
            // A check that began before the change cannot answer for after it
            this.inFlight = undefined;
            this.refresh();
        });
    }

    /** The state as last checked; `unknown` until the first check finishes. */
    get state(): CloudAccountState {
        return this._state;
    }

    /** The logged-in account, or `undefined` unless the state is `logged-in`. */
    get account(): CloudAccount | undefined {
        return this._state.kind === 'logged-in' ? this._state.account : undefined;
    }

    /**
     * Asks the backend who is logged in and returns the answer, joining a check already under way.
     *
     * Never rejects: a check that fails answers `error`. The answer becomes {@link CloudAccountService.state} only if no later check started
     * meanwhile (a login or logout starts one), but it is returned either way.
     */
    refresh(): Promise<CloudAccountState> {
        if (!this.inFlight) {
            const check = this.check();
            this.inFlight = check;
            check.finally(() => {
                if (this.inFlight === check) {
                    this.inFlight = undefined;
                }
            });
        }
        return this.inFlight;
    }

    private async check(): Promise<CloudAccountState> {
        const refresh = ++this.latestRefresh;
        let state: CloudAccountState;
        try {
            const account = await this.auth.whoAmI();
            state = account ? { kind: 'logged-in', account } : { kind: 'logged-out' };
        } catch (e) {
            state = { kind: 'error', reason: e instanceof Error ? e.message : String(e) };
        }
        // A refresh started after this one, e.g. by a logout, knows better
        if (refresh === this.latestRefresh) {
            this.setState(state);
        }
        return state;
    }

    /** Makes `state` the current state and tells the listeners, unless it equals the current one by value. */
    protected setState(state: CloudAccountState): void {
        // Listeners rebuild menus, and in Electron the whole native menu bar, so only tell them about a change
        if (JSON.stringify(state) === JSON.stringify(this._state)) {
            return;
        }
        const before = this.account;
        this._state = state;
        if (state.kind === 'logged-in' && state.account.userId !== before?.userId) {
            this.logger.info(`Logged in to the cloud registry as ${CloudAccount.label(state.account)} (user ${state.account.userId}, platform role ${state.account.platformRole})`);
        } else if (state.kind === 'error') {
            this.logger.warn(`Could not get the logged-in account: ${state.reason}`);
        }
        this.onDidChangeEmitter.fire(state);
    }
}
