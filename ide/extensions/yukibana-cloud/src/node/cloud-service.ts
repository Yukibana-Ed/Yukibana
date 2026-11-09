/**
 * SPDX-License-Identifier: MIT
 */
import { ILogger } from '@theia/core';
import { FileUri } from '@theia/core/lib/node';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { RegistryError, unpackStarter } from '@yukibana/client';
import { SubmissionServiceImpl } from '@yukibana/ide-submission-ext/lib/node/submission-service';
import { CloudService, DownloadResult, ProjectListing, ProjectLookup, SubmissionResult, SubmitAvailability } from '../common/cloud-protocol';
import { CloudClient, isRefused } from './cloud-client';
import { CloudSessionManager } from './cloud-session-manager';

/** The backend's {@link CloudService}, one for every window, asking the registry as the IDE's one session. */
@injectable()
export class CloudServiceImpl implements CloudService {
    /** The registry, asked as whoever the session is for. */
    @inject(CloudClient) protected readonly client!: CloudClient;
    /** The session, asked whether one is kept when a call fails. */
    @inject(CloudSessionManager) protected readonly sessions!: CloudSessionManager;
    /** Where failed listings and downloads, and entries left out of a starter, are written down. */
    @inject(ILogger) @named('yukibana:CloudService') protected readonly logger!: ILogger;
    /** The submissions prepared for sending, by id. */
    @inject(SubmissionServiceImpl) protected readonly submissions!: SubmissionServiceImpl;

    /** Sends a prepared submission; see {@link CloudService.submit}. The submission stays prepared either way. */
    async submit(projectId: string, submissionId: string): Promise<SubmissionResult> {
        const bundle = this.submissions.bundle(submissionId);
        if (bundle === undefined) {
            return { ok: false, reason: 'the submission is no longer prepared; submit again' };
        }
        try {
            const result = await this.client.submit(bundle, projectId);
            return {
                ok: true,
                ...result,
            };
        } catch (e) {
            return {
                ok: false,
                reason: e instanceof Error ? e.message : String(e),
            };
        }
    }

    /** Returns the project, or why there is none; see {@link CloudService.getProjectInfo}. */
    async getProjectInfo(projectId: string): Promise<ProjectLookup> {
        try {
            return { kind: 'found', project: await this.client.project(projectId) };
        } catch (e) {
            if (e instanceof RegistryError && e.status === 404) {
                return { kind: 'not-found' };
            }
            if (await this.isLoggedOut(e)) {
                return { kind: 'not-logged-in' };
            }
            throw e;
        }
    }

    /** Returns the projects the person can see; see {@link CloudService.listProjects}. */
    async listProjects(): Promise<ProjectListing> {
        try {
            return { kind: 'found', projects: await this.client.projects() };
        } catch (e) {
            if (await this.isLoggedOut(e)) {
                return { kind: 'not-logged-in' };
            }
            // The welcome screen shows the reason rather than an empty list, which would read as nothing due
            this.logger.warn(`Could not list projects: ${e instanceof Error ? e.message : String(e)}`);
            return { kind: 'error', reason: e instanceof Error ? e.message : String(e) };
        }
    }

    /** Returns `true` iff `e`, from a registry call, means nobody is logged in. */
    protected async isLoggedOut(e: unknown): Promise<boolean> {
        return isRefused(e) || !(await this.sessions.isLoggedIn());
    }

    /** Unpacks the project's starter; see {@link CloudService.downloadProject}. */
    async downloadProject(projectId: string, destinationURI: string): Promise<DownloadResult> {
        try {
            const leftOut = await unpackStarter(await this.client.downloadStarter(projectId), FileUri.fsPath(destinationURI));
            for (const entry of leftOut) {
                this.logger.warn(`Not unpacked from the starter of ${projectId}: ${entry}`);
            }
            return { ok: true, leftOut };
        } catch (e) {
            this.logger.error(e instanceof Error ? e : String(e));
            return { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
    }

    /** Returns whether the person may submit now; see {@link CloudService.canSubmitProject}. */
    canSubmitProject(projectId: string): Promise<SubmitAvailability> {
        return this.client.isProjectAcceptingSubmissions(projectId);
    }
}
