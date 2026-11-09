/**
 * SPDX-License-Identifier: MIT
 */
import { inject, injectable } from '@theia/core/shared/inversify';
import { NotLoggedIn, Project, RegistryError, tokenProvider, YukibanaClient } from '@yukibana/client';
import { CloudSessionManager, DEFAULT_REGISTRY } from './cloud-session-manager';
import { CanSubmitStatus, SubmitAvailability } from '../common/cloud-protocol';

/**
 * Whether the registry or the Auth server refused the session, as opposed to not being reached.
 * `tokenProvider` reports every failed refresh as `NotLoggedIn`, network errors included, and only
 * the wrapped message tells an answer from the Auth server apart from no answer at all.
 */
export function isRefused(e: unknown): boolean {
    return (e instanceof RegistryError && e.status === 401) || (e instanceof NotLoggedIn && /the Auth server answered 4\d\d/.test(e.message));
}

/**
 * The registry at {@link DEFAULT_REGISTRY}, asked as whoever the IDE's one session is for.
 *
 * Every call takes its access token from the session, refreshing (and saving) it first when it is about to expire;
 * with no session kept, a call rejects with `NotLoggedIn` before anything is sent.
 */
@injectable()
export class CloudClient extends YukibanaClient {
    /** Makes the client of `cloudService`'s session, which it keeps as `cloudService`: the session every call is made with. */
    constructor(@inject(CloudSessionManager) protected readonly cloudService: CloudSessionManager) {
        super({
            url: DEFAULT_REGISTRY,
            accessToken: tokenProvider(cloudService),
        });
    }

    /**
     * Returns whether the caller may submit for `projectId` now, by the project the registry answers and the clock of
     * this machine; see {@link CanSubmitStatus} for the order it is decided in.
     *
     * Never rejects: any failure to get the project, being logged out or a 404 included, is `UNKNOWN` with no project.
     * A date the registry sends that does not parse is not a bound: it neither keeps the window shut nor closes it.
     */
    async isProjectAcceptingSubmissions(projectId: string): Promise<SubmitAvailability> {
        try {
            const project = await this.project(projectId);
            return { status: this.submitStatus(project), project };
        } catch {
            return { status: CanSubmitStatus.UNKNOWN };
        }
    }

    private submitStatus(project: Project): CanSubmitStatus {
        // The registry's canSubmit is also false outside the window, which the dates below say better
        if (project.role !== 'student') {
            return CanSubmitStatus.NOT_ALLOWED;
        }
        const now = Date.now();
        const start = this.parseDate(project.availableAfter);
        if (start === undefined || now < start) {
            return CanSubmitStatus.NOT_OPEN;
        }
        const end = this.parseDate(project.closesAt);
        if (end !== undefined && now > end) {
            return CanSubmitStatus.CLOSED;
        }
        if (!project.canSubmit) {
            return CanSubmitStatus.NOT_ALLOWED;
        }
        const deadline = this.parseDate(project.deadline);
        if (deadline !== undefined && now > deadline) {
            return CanSubmitStatus.LATE;
        }
        return CanSubmitStatus.OPEN;
    }

    private parseDate(dateStr: string | null): number | undefined {
        if (!dateStr) {
            return undefined;
        }
        try {
            return Date.parse(dateStr);
        } catch {
            return undefined;
        }
    }
}
