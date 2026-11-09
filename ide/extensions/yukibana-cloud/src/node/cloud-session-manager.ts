/**
 * SPDX-License-Identifier: MIT
 */
import { Emitter, ILogger } from '@theia/core';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { CallbackOutcome, loginCode, logout as endSession, loginWithLoopback, memoryStore, Session, SessionStore } from '@yukibana/client';
import { LoginResult } from '../common/cloud-protocol';

/** The registry the IDE logs in to and asks: the production one, and the only one; no preference changes it. */
export const DEFAULT_REGISTRY = 'https://cloud.yukibana.dev';
const SESSION_KEY = 'yukibana.cloud.session';
const SESSION_ACCOUNT = 'session';

/** Opens the login page; `code` is what that page shows too. */
export type OpenLoginUrl = (url: string, code?: string) => void;

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/**
 * The IDE's one session with {@link DEFAULT_REGISTRY}, shared by every window, kept as JSON in the system keystore;
 * and logging in and out of it.
 *
 * It is also the {@link SessionStore} the registry client refreshes tokens through, so a refreshed session is saved
 * here too (without firing {@link CloudSessionManager.onLoginChanged}).
 */
@injectable()
export class CloudSessionManager implements SessionStore {
    /** Where logins and logouts are written down. */
    @inject(ILogger) @named('yukibana:CloudService') protected readonly logger!: ILogger;
    /** The system keystore the session is kept in. */
    @inject(KeyStoreService) protected readonly keyStoreService!: KeyStoreService;

    private pending?: Promise<LoginResult>;

    private readonly onLoginChangedEmitter = new Emitter<void>();
    /** Fires on login and logout, not on token refreshes. */
    readonly onLoginChanged = this.onLoginChangedEmitter.event;

    private loginCallbackPage(outcome: CallbackOutcome): string {
        const [title, text] = outcome.ok
            ? ['Signed in to Yukibana', 'You may close this tab and return to the application.']
            : ['Sign-in was not completed', escapeHtml(outcome.reason)];
        return (
            '<!doctype html>' +
            '<meta charset="utf-8">' +
            `<title>${title}</title>` +
            '<body style="font-family:system-ui;max-width:32rem;margin:4rem auto">' +
            `<h1>${title}</h1>` +
            `<p>${text}</p>` +
            '</body>'
        );
    }

    /**
     * Logs in through a loopback callback on this machine, with `open` opening the login page, saves the session, and
     * returns how it went.
     *
     * Only one login runs at a time: a call while one is under way joins it, and its `open` is never called. Never
     * rejects: a login that fails, is cancelled, or whose session cannot be saved is `ok: false`. A login that ends
     * with a session replaces the one kept, without ending it at the Auth server, and fires
     * {@link CloudSessionManager.onLoginChanged}.
     */
    async login(open: OpenLoginUrl): Promise<LoginResult> {
        this.pending ??= this.doLogin(open).finally(() => {
            this.pending = undefined;
        });
        return this.pending;
    }

    private async doLogin(open: OpenLoginUrl): Promise<LoginResult> {
        this.logger.info('Logging in...');
        try {
            const session = await loginWithLoopback(DEFAULT_REGISTRY, {
                callbackPage: o => this.loginCallbackPage(o),
                open: url => open(url.toString(), loginCode(url) ?? undefined),
            });
            this.logger.info('Received session');
            await this.saveSession(session);
            this.onLoginChangedEmitter.fire();
            return { ok: true };
        } catch (e) {
            return {
                ok: false,
                reason: e instanceof Error ? e.message : String(e),
            };
        }
    }

    /**
     * Logs in afresh and only then ends the session it replaces, so a cancelled login leaves the person logged in.
     *
     * The old session is ended at the Auth server without waiting, and a failure to end it is ignored. Joins a login
     * already under way, as {@link CloudSessionManager.login} does.
     */
    async switchAccount(open: OpenLoginUrl): Promise<LoginResult> {
        const previous = await this.getSession();
        const result = await this.login(open);
        if (result.ok && previous) {
            endSession(memoryStore(previous)).catch(() => undefined);
        }
        return result;
    }

    /**
     * Forgets the session, asks the Auth server to end it, and fires {@link CloudSessionManager.onLoginChanged}.
     *
     * The session is forgotten first, so that it is gone even when the Auth server cannot be reached; that is only
     * logged, because the refresh token then still works until it expires. Rejects only when the keystore fails, and
     * then fires nothing.
     */
    async logout(): Promise<void> {
        this.logger.info('Logging out...');
        const { revoked, why } = await endSession(this);
        if (revoked) {
            this.logger.info('Session ended at the Auth server');
        } else {
            this.logger.warn(`Session forgotten here, but the Auth server did not end it: ${why}`);
        }
        this.onLoginChangedEmitter.fire();
    }

    /** Forgets a session without asking the Auth server, for one it no longer accepts. */
    async forget(): Promise<void> {
        await this.deleteSession();
        this.onLoginChangedEmitter.fire();
    }

    /**
     * Returns `true` iff the keystore holds a session that parses. Says nothing about whether the registry still
     * accepts it; a session that does not parse is deleted.
     */
    async isLoggedIn(): Promise<boolean> {
        const session = await this.getSession();
        return !!session;
    }

    private async saveSession(session: Session): Promise<void> {
        await this.keyStoreService.setPassword(SESSION_KEY, SESSION_ACCOUNT, JSON.stringify(session));
    }

    private async deleteSession(): Promise<void> {
        await this.keyStoreService.deletePassword(SESSION_KEY, SESSION_ACCOUNT);
    }

    private async getSession(): Promise<Session | undefined> {
        const session = await this.keyStoreService.getPassword(SESSION_KEY, SESSION_ACCOUNT);
        if (!session) {
            return undefined;
        }
        try {
            return JSON.parse(session) as Session;
        } catch {
            await this.deleteSession();
            return undefined;
        }
    }

    /** Returns the session kept, or null when there is none or it does not parse (which deletes it). */
    async load(): Promise<Session | null> {
        // eslint-disable-next-line no-null/no-null
        return (await this.getSession()) ?? null;
    }

    /** Replaces the session kept with `session`, as a token refresh does; fires nothing, since nobody logged in or out. */
    save(session: Session): Promise<void> {
        return this.saveSession(session);
    }

    /** Forgets the session kept; fires nothing, so a caller that logs someone out says so itself. */
    clear(): Promise<void> {
        return this.deleteSession();
    }
}
